// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { GrammarPart, GrammarRule, RulesPart } from "../src/grammarTypes.js";

function findFirstRulesPart(rules: GrammarRule[]): RulesPart | undefined {
    const visit = (parts: GrammarPart[]): RulesPart | undefined => {
        for (const p of parts) {
            if (p.type === "rules") return p;
        }
        for (const p of parts) {
            if (p.type === "rules") {
                for (const r of p.rules) {
                    const inner = visit(r.parts);
                    if (inner) return inner;
                }
            }
        }
        return undefined;
    };
    for (const r of rules) {
        const found = visit(r.parts);
        if (found) return found;
    }
    return undefined;
}

function match(grammar: ReturnType<typeof loadGrammarRules>, request: string) {
    return matchGrammar(grammar, request).map((m) => m.match);
}

describe("Grammar Optimizer - Common prefix factoring", () => {
    it("factors a literal common prefix across alternatives", () => {
        // Three alternatives all share "play the ".
        const text = `<Start> = <Choice>;
<Choice> = play the song -> "song" | play the track -> "track" | play the album -> "album";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });

        // Match results unchanged.
        for (const input of [
            "play the song",
            "play the track",
            "play the album",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }

        // The optimized AST has fewer top-level alternatives in <Choice>.
        const optChoice = findFirstRulesPart(optimized.rules);
        const baseChoice = findFirstRulesPart(baseline.rules);
        expect(optChoice).toBeDefined();
        expect(baseChoice).toBeDefined();
        expect(optChoice!.rules.length).toBeLessThan(baseChoice!.rules.length);
    });

    it("preserves match results when alternatives use different variable names", () => {
        const text = `<Start> = <Choice>;
<Choice> = play $(a:string) -> { kind: "a", v: a }
         | play $(b:string) -> { kind: "b", v: b };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        const baseRes = match(baseline, "play hello");
        const optRes = match(optimized, "play hello");
        // Should produce the same set of results (order may differ).
        expect(optRes.length).toBe(baseRes.length);
        expect(optRes).toEqual(expect.arrayContaining(baseRes));
        expect(baseRes).toEqual(expect.arrayContaining(optRes));
    });

    it("no-op when there is only one alternative", () => {
        const text = `<Start> = play the song -> "song";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        expect(JSON.stringify(optimized.rules)).toBe(
            JSON.stringify(baseline.rules),
        );
    });

    it("no-op when alternatives share no leading parts", () => {
        const text = `<Start> = <Choice>;
<Choice> = foo -> 1 | bar -> 2 | baz -> 3;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        // No shared first part, factoring has nothing to do.
        const optChoice = findFirstRulesPart(optimized.rules);
        const baseChoice = findFirstRulesPart(baseline.rules);
        expect(optChoice!.rules.length).toBe(baseChoice!.rules.length);
        for (const input of ["foo", "bar", "baz"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("does not touch repeat groups", () => {
        const text = `<Start> = (a x | a y)+ -> true;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        // Repeat groups aren't factored — top-level RulesPart with
        // repeat=true is left as-is.  Match results must still agree.
        expect(match(optimized, "a x a y")).toStrictEqual(
            match(baseline, "a x a y"),
        );
    });

    it("factors shared sub-prefixes inside the suffix group", () => {
        // Two of the three alternatives share a longer prefix (`play song`)
        // beyond the global shared prefix (`play `).  The optimizer should
        // factor the deeper sharing as well, not just the outermost.
        const text = `<Start> = <C>;
<C> = play song $(x:string) -> { kind: "song-x", x }
    | play song $(y:string) -> { kind: "song-y", y }
    | play album $(z:string) -> { kind: "album", z };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play song hello",
            "play album world",
            "play unknown",
        ]) {
            const baseRes = match(baseline, input);
            const optRes = match(optimized, input);
            expect(optRes.length).toBe(baseRes.length);
            expect(optRes).toEqual(expect.arrayContaining(baseRes));
        }
        // Structural: the optimized AST should have nested factoring —
        // top-level RulesPart with one alternative whose suffix RulesPart
        // itself contains a further factored rule for `song`.
        const optChoice = findFirstRulesPart(optimized.rules);
        expect(optChoice).toBeDefined();
        // <C> reduces to a single shared-prefix wrapper.
        expect(optChoice!.rules.length).toBe(1);
        const factored = optChoice!.rules[0];
        // Find the inner RulesPart (the suffix group).
        const innerWrapper = factored.parts.find((p) => p.type === "rules");
        expect(innerWrapper).toBeDefined();
        // The inner suffix group should have collapsed `song x | song y` so
        // its rule count is 2 (one combined `song …` alt + the `album …`
        // alt) rather than 3.
        expect((innerWrapper as { rules: unknown[] }).rules.length).toBe(2);
    });

    it("factors common prefixes across top-level rules", () => {
        // Three top-level alternatives all share "play the ".
        // Top-level factoring should reduce the rule count and preserve
        // match results.
        const text = `<Start> = play the song -> "song"
         | play the track -> "track"
         | play the album -> "album";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        // Factoring collapses the 3 top-level alternatives into 1
        // (a shared-prefix rule with a 3-alternative suffix RulesPart).
        expect(optimized.rules.length).toBeLessThan(baseline.rules.length);
        for (const input of [
            "play the song",
            "play the track",
            "play the album",
        ]) {
            const baseRes = match(baseline, input);
            const optRes = match(optimized, input);
            expect(optRes.length).toBe(baseRes.length);
            expect(optRes).toEqual(expect.arrayContaining(baseRes));
        }
    });

    // ── Eligibility-bailout coverage ────────────────────────────────────

    it("bails out (implicit-default-multipart) when value-less members differ in part count", () => {
        // All three alternatives lack an explicit `value` and the
        // matcher's default-value rule applies.  Two of them are
        // multi-part (more than one inlined part after factoring the
        // shared `play `).  The factorer's eligibility check refuses
        // wrapping because a wrapped `RulesPart` whose members default
        // would feed the matcher's "missing value for default" path.
        // Match results must still agree.
        const text = `<Start> = $(t:<C>) -> { v: t };
<C> = play $(a:string) | play $(b:string) loud | play $(c:string) softly;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play hello",
            "play hello loud",
            "play hello softly",
        ]) {
            const baseRes = match(baseline, input);
            const optRes = match(optimized, input);
            expect(optRes.length).toBe(baseRes.length);
            expect(optRes).toEqual(expect.arrayContaining(baseRes));
        }
    });

    it("bails out (mixed-value-presence) when some members have value and others don't", () => {
        // Two alternatives share a literal prefix.  One has an
        // explicit value, the other doesn't.  The factorer's
        // eligibility check refuses to wrap a fork with mixed
        // value-presence: a wrapper RulesPart binds either everything
        // or nothing, not both.
        const text = `<Start> = $(t:<C>) -> { v: t };
<C> = play $(a:string) -> { kind: "a", a } | play $(b:string);`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        const baseRes = match(baseline, "play hello");
        const optRes = match(optimized, "play hello");
        expect(optRes.length).toBe(baseRes.length);
        expect(optRes).toEqual(expect.arrayContaining(baseRes));
    });

    // ── Trie-edge variant coverage ──────────────────────────────────────

    it("does not merge wildcards with different optional flags into one edge", () => {
        // Two alternatives share `play $(x:string)` shape but one
        // marks the wildcard optional.  `edgeKeyMatches` requires
        // matching `optional` flags, so the factorer must keep them as
        // distinct edges.  Match results agree.
        const text = `<Start> = play $(x:string) here -> { kind: "here", x }
         | play $(y:string)? there -> { kind: "there", y };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play hello here",
            "play hello there",
            "play there",
        ]) {
            const baseRes = match(baseline, input);
            const optRes = match(optimized, input);
            expect(optRes.length).toBe(baseRes.length);
            expect(optRes).toEqual(expect.arrayContaining(baseRes));
        }
    });

    it("does not merge wildcards with different typeNames into one edge", () => {
        // `string` and `wildcard` typeNames produce distinct trie
        // edges (different runtime entity-type semantics).  Match
        // results agree.
        const text = `<Start> = play $(x:string) once -> { kind: "s", x }
         | play $(y:wildcard) twice -> { kind: "w", y };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play hello once", "play hello twice"]) {
            const baseRes = match(baseline, input);
            const optRes = match(optimized, input);
            expect(optRes.length).toBe(baseRes.length);
            expect(optRes).toEqual(expect.arrayContaining(baseRes));
        }
    });
});

// ─── Merged from grammarOptimizerFactoringRepro.spec.ts ──────────────────────
describe("Grammar Optimizer - Factoring Repro", () => {
    it("handles alternatives that re-use the same variable name", () => {
        const text = `<Start> = <Play>;
<Play> = play $(trackName:string) -> { kind: "solo", trackName }
       | play $(trackName:string) by $(artist:string) -> { kind: "duet", trackName, artist };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play Hello",
            "play Shake It Off by Taylor Swift",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("handles a group that is fully consumed by the shared prefix", () => {
        const text = `<Start> = <X>;
<X> = play -> "just"
    | play the song -> "song"
    | play the track -> "track";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play", "play the song", "play the track"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("handles mixed explicit / default value alternatives", () => {
        const text = `<Start> = <X>;
<X> = play the song
    | play the track -> "custom";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play the song", "play the track"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("handles shared literal prefix with distinct wrapped RulesParts (player-like)", () => {
        const text = `<Start> = <PlaySpecificTrack>;
<TrackPhrase> = $(trackName:string) -> trackName
              | the $(trackName:string) -> trackName;
<PlaySpecificTrack> = play $(trackName:<TrackPhrase>) by $(artist:string) -> { kind: "byArtist", trackName, artist }
                    | play $(trackName:<TrackPhrase>) from album $(albumName:string) -> { kind: "fromAlbum", trackName, albumName };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play hello by taylor",
            "play the hello by taylor",
            "play hello from album unity",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // Regression for the failure surfaced by the optimizer benchmark
    // against the player grammar:
    //
    //     "Internal error: No value for variable 'trackName'.
    //      Values: {"name":"artist","valueId":4}"
    //
    // Object shorthand `{ trackName }` compiles to a property element
    // with `value: null` (key = "trackName", expanded at evaluation
    // time to `trackName: trackName`).  Variable-renaming during
    // factoring must (a) detect that the key is a variable reference
    // and (b) rewrite it without changing the object field name.
    it("rewrites object shorthand keys when remapping variables", () => {
        const text = `<Start> = <X>;
<X> = greet $(name:string) -> { name }
    | greet $(other:string) twice -> { other };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["greet alice", "greet bob twice"]) {
            // No "Internal error" thrown, and matches identical.
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // Regression for the playerSchema bug.  The failing trie shape:
    //
    //     play <TrackPhrase> by <ArtistName>                                  (alt1)
    //     play <TrackPhrase> from album <AlbumName>                           (alt2)
    //     play <TrackPhrase> by <ArtistName> from album <AlbumName>           (alt3)
    //
    // The trie at <TrackPhrase> forks ("by" vs "from"); inside the "by"
    // branch, alt1's terminal lands at <ArtistName> with empty parts
    // alongside alt3's "from album <AlbumName>" subtree.  That deeper
    // fork bails ("whole-consumed") and prepends the <ArtistName> edge
    // to each member.  The outer "by" fork's eligibility check then sees
    // members whose values reference the *outer* <TrackPhrase> canonical
    // — but that canonical isn't bound in the members' own parts.  The
    // pre-fix check missed this (it only compared against the immediate
    // "by" prefix, which has no canonicals), factored anyway, and the
    // matcher threw at runtime:
    //   "Internal error: No value for variable '__opt_v_*'".
    it("does not factor when members reference ancestor-prefix bindings", () => {
        const text = `<Start> = <PlaySpecificTrack>;
<TrackPhrase> = $(trackName:string) -> trackName
              | the $(trackName:string) -> trackName;
<PlaySpecificTrack> =
    play $(trackName:<TrackPhrase>) by $(artist:string) ->
        { kind: "byArtist", trackName, artist }
    | play $(trackName:<TrackPhrase>) from album $(albumName:string) ->
        { kind: "fromAlbum", trackName, albumName }
    | play $(trackName:<TrackPhrase>) by $(artist:string) from album $(albumName:string) ->
        { kind: "byArtistFromAlbum", trackName, artist, albumName };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play hello by alice",
            "play the hello by alice",
            "play hello from album greats",
            "play hello by alice from album greats",
            "play the hello by alice from album greats",
        ]) {
            // No "Internal error" thrown at runtime, and the same set
            // of matches is produced (order may differ, since factoring
            // can interleave alternatives at the wrapper level).
            const baseRes = match(baseline, input);
            const optRes = match(optimized, input);
            expect(optRes).toHaveLength(baseRes.length);
            expect(optRes).toEqual(expect.arrayContaining(baseRes));
            expect(baseRes).toEqual(expect.arrayContaining(optRes));
        }
    });
});

// ─── Merged from grammarOptimizerTrieRisks.spec.ts ──────────────────────────
function findAllRulesParts(rules: GrammarRule[]): RulesPart[] {
    const out: RulesPart[] = [];
    const visit = (parts: GrammarPart[]) => {
        for (const p of parts) {
            if (p.type === "rules") {
                out.push(p);
                for (const r of p.rules) visit(r.parts);
            }
        }
    };
    for (const r of rules) visit(r.parts);
    return out;
}

describe("Grammar Optimizer - Trie risks", () => {
    // ── Risk: cross-scope reference forces bailout, but factoring above
    //         the bailed fork still applies.
    it("bailout at one fork still allows factoring above", () => {
        // <Inner> binds `trackName`; both <Play> alternatives reference
        // it in their value expression — factoring the <Inner> RulesPart
        // would put the binding into outer scope, which the matcher
        // can't see.  The deep fork bails, but `play` should still get
        // factored at the outer level.
        const text = `<Start> = <Play>;
<Inner> = $(trackName:string) -> trackName | the $(trackName:string) -> trackName;
<Play> = play $(trackName:<Inner>) by $(artist:string) -> { kind: "by", trackName, artist }
       | play $(trackName:<Inner>) from album $(albumName:string) -> { kind: "from", trackName, albumName };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play hello by alice",
            "play the world from album unity",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: shared RulesPart array identity must be preserved (the
    //         serializer dedupes by Map<GrammarRule[], number>).
    it("preserves shared RulesPart array identity", () => {
        // Two top-level alternatives both reference <Inner>.  After
        // factoring, every emitted RulesPart that points at <Inner>
        // should share the same `rules` array object.
        const text = `<Start> = <Cmd>;
<Inner> = a -> 1 | b -> 2;
<Cmd> = play $(x:<Inner>) -> { kind: "play", x }
      | stop $(x:<Inner>) -> { kind: "stop", x };`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        const innerRulesArrays = new Set<unknown>();
        for (const rp of findAllRulesParts(optimized.rules)) {
            // Heuristic: any RulesPart with two child rules whose first
            // parts are both phraseSet/string and whose values are 1 / 2
            // is the <Inner> body.
            if (
                rp.rules.length === 2 &&
                rp.rules[0].value !== undefined &&
                rp.rules[1].value !== undefined &&
                JSON.stringify(rp.rules[0].value) ===
                    '{"type":"literal","value":1}' &&
                JSON.stringify(rp.rules[1].value) ===
                    '{"type":"literal","value":2}'
            ) {
                innerRulesArrays.add(rp.rules);
            }
        }
        // Both references to <Inner> produce edges that point at the
        // same `rules` array (Set size === 1).
        expect(innerRulesArrays.size).toBe(1);
    });

    // ── Risk: a rule whose entire path is a strict prefix of another's
    //         path becomes a terminal AND a forking node at the same
    //         trie spot.
    it("handles a rule that is a strict prefix of another (no values)", () => {
        const text = `<Start> = <X>;
<X> = play
    | play song;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play", "play song"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: same as above, but mixed value-presence forces bailout
    //         (the shorter rule has explicit value, the longer doesn't).
    it("handles strict-prefix overlap with mixed value-presence", () => {
        const text = `<Start> = <X>;
<X> = play -> "just"
    | play song;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play", "play song"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: deep multi-level factoring — three layers of shared
    //         prefix should all collapse.
    it("factors at multiple depths (a b c x | a b c y | a b d z)", () => {
        const text = `<Start> = <X>;
<X> = a b c x -> 1
    | a b c y -> 2
    | a b d z -> 3;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["a b c x", "a b c y", "a b d z"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: variable name collision across alternatives — the lead
    //         alternative's variable name wins; later alternatives' value
    //         expressions must be remapped.
    it("canonicalizes variable names from differently-named bindings", () => {
        const text = `<Start> = <C>;
<C> = play $(track:string) once -> { kind: "once", track }
    | play $(song:string) twice -> { kind: "twice", v: song };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play hello once", "play hello twice"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: factoring intersects with object-shorthand value.  After
    //         remapping, `{ name }` from a non-lead alternative must be
    //         expanded to `{ name: <canonical> }` so the field key
    //         doesn't change.
    it("rewrites object shorthand keys when remapping (non-lead alt)", () => {
        const text = `<Start> = <X>;
<X> = greet $(name:string) -> { name }
    | greet $(other:string) twice -> { other };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["greet alice", "greet bob twice"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: order preservation across multiple groups at the same
    //         trie level — output ordering should match the original
    //         rule order semantically (same matches).
    it("preserves match order across interleaved groups", () => {
        // Three groups: foo*, bar*, foo* again.  Trie merges the two
        // foo* rules (insertion-order at root), bar stays separate.
        const text = `<Start> = <X>;
<X> = foo a -> 1
    | bar -> 2
    | foo b -> 3;`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["foo a", "foo b", "bar"]) {
            // Same multi-set of match results.
            const baseRes = match(baseline, input).map((m) =>
                JSON.stringify(m),
            );
            const optRes = match(optimized, input).map((m) =>
                JSON.stringify(m),
            );
            expect(optRes.sort()).toStrictEqual(baseRes.sort());
        }
    });

    // ── Risk: nested factoring + outer factoring composing — the inner
    //         RulesPart returned by emit() is reused as a member at the
    //         outer level, so the wrapper's variable name must not
    //         collide with the inner wrapper's.
    it("avoids wrapper-variable collisions across nested factoring", () => {
        const text = `<Start> = <X>;
<X> = play song red -> "sr"
    | play song blue -> "sb"
    | play album green -> "ag"
    | play album yellow -> "ay";`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of [
            "play song red",
            "play song blue",
            "play album green",
            "play album yellow",
        ]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: outer-name shadow.  With first-inserter-wins canonical
    //         naming, a non-lead alternative whose value happens to use
    //         a name that matches the lead's local binding would have
    //         the local renamed onto the lead's canonical, silently
    //         changing what name the value resolves against.  With
    //         opaque canonicals (`__opt_v_<n>`) this collision class is
    //         impossible by construction; the emitted variable name is
    //         synthetic and cannot collide with any user-named ref.
    it("opaque canonicals avoid outer-name shadowing", () => {
        // Both alternatives bind their wildcard but the *non-lead* one
        // happens to spell its local with the same name (`x`) the lead
        // would have used as canonical.  Under first-inserter-wins the
        // second's value `{tag: "B", v: x}` would alias the lead's `x`;
        // under opaque canonicals each side keeps its own remap and the
        // emitted output is unambiguous.
        const text = `<Start> = <X>;
<X> = play $(x:string) once -> { tag: "A", v: x }
    | play $(x:string) twice -> { tag: "B", v: x };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play hello once", "play world twice"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: bound vs. unbound RulesPart references at the same edge.
    //         Without binding-presence parity they would merge, either
    //         inventing a binding the unbound side never had or
    //         dropping a binding the bound side depends on.
    it("does not merge bound and unbound <Inner> references", () => {
        // Two alternatives both reference <Inner>; the second binds it
        // and uses the binding in its value.  Parity check should keep
        // them as separate trie children.
        const text = `<Start> = <X>;
<Inner> = a -> 1 | b -> 2;
<X> = play <Inner> -> "no-bind"
    | play $(v:<Inner>) -> { kind: "bound", v };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play a", "play b"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    // ── Risk: under "first-inserter-wins" canonical naming, the lead's
    //         local becomes the canonical for the merged prefix edge.
    //         A NON-LEAD alternative can have a SUFFIX binding whose
    //         name happens to match the lead's local — and whose value
    //         expression references that name.  Under the broken
    //         scheme, the non-lead's value references the suffix
    //         binding, but matcher resolution hits the prefix binding
    //         first (the suffix binding is in the wrapper's nested
    //         scope and the value would *not* see it correctly).
    //
    //         Under the opaque scheme: prefix canonical is `__opt_v_0`
    //         (synthetic, cannot collide with user names), and the
    //         non-lead's suffix binding `x` stays `x` after remap (its
    //         local doesn't get renamed because the suffix binding is
    //         on a DIFFERENT trie edge from the prefix).  Value `{x}`
    //         resolves to the suffix binding correctly.
    //
    //         Critically, this also exercises the "lead must record
    //         its own remap" property: the lead's `x` local in its
    //         value expression must be remapped to `__opt_v_0`.
    //         Without that remap, the matcher fails to resolve `x`.
    it("opaque canonicals + lead remap handle prefix/suffix name reuse", () => {
        const text = `<Start> = <X>;
<X> = play $(x:string) -> { kind: "lead", v: x }
    | play $(a:string) then $(x:string) -> { kind: "alt", v: x };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["play hello", "play first then second"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });
});

describe("Grammar Optimizer - Trie edge variants (number, phraseSet, optional)", () => {
    // ── Number-edge factoring: `stepMergeKey` keys number edges by
    //    optional flag only; both alternatives share the same
    //    number-with-no-optional edge and should merge.
    it("factors a shared number wildcard prefix across alternatives", () => {
        const text = `<Start> = <C>;
<C> = volume $(n:number) up -> { dir: "up", n }
    | volume $(n:number) down -> { dir: "down", n };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        const optChoice = findFirstRulesPart(optimized.rules);
        const baseChoice = findFirstRulesPart(baseline.rules);
        // Factoring collapses 2 alternatives into 1 wrapper.
        expect(optChoice!.rules.length).toBeLessThan(baseChoice!.rules.length);
        for (const input of ["volume 5 up", "volume 7 down"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("factors with optional-number edges merging only with matching flag", () => {
        // Two alternatives that share `set $(n:number)?` (optional
        // number).  The optional flag on the number edge is part of
        // the merge key; both sides agree, so factoring fires.
        const text = `<Start> = <C>;
<C> = set $(n:number)? on -> { state: "on", n }
    | set $(n:number)? off -> { state: "off", n };`;
        const baseline = loadGrammarRules("t.grammar", text);
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        for (const input of ["set on", "set 5 on", "set off", "set 7 off"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });
});

describe("Grammar Optimizer - Wrapper rule spacingMode propagation", () => {
    // When all factored members share a non-default `spacingMode`, the
    // synthesized wrapper rule inherits it.  Top-level <Start> has
    // multiple definitions each annotated `[spacing=required]`; the
    // top-level factorer factors across them and the resulting
    // wrapper rule must carry `spacingMode: "required"`.
    it("propagates shared explicit spacingMode onto the wrapper rule", () => {
        const text = `<Start> [spacing=required] = play hello -> 1;
<Start> [spacing=required] = play world -> 2;`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        // Top-level reduces to a single shared-prefix wrapper.
        expect(optimized.rules.length).toBe(1);
        expect(optimized.rules[0].spacingMode).toBe("required");

        // And matching still respects the required-spacing semantics.
        const baseline = loadGrammarRules("t.grammar", text);
        for (const input of ["play hello", "play world", "playhello"]) {
            expect(match(optimized, input)).toStrictEqual(
                match(baseline, input),
            );
        }
    });

    it("does not set wrapper spacingMode when members disagree", () => {
        // Members with differing spacingMode → wrapper stays default
        // (auto / undefined).
        const text = `<Start> [spacing=required] = play hello -> 1;
<Start> [spacing=optional] = play world -> 2;`;
        const optimized = loadGrammarRules("t.grammar", text, {
            optimizations: { factorCommonPrefixes: true },
        });
        expect(optimized.rules.length).toBe(1);
        expect(optimized.rules[0].spacingMode).toBeUndefined();
    });
});
