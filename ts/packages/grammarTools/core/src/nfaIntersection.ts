// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * NFA intersection / overlap detection.
 *
 * Given two compiled NFAs (typically one per agent grammar), decide whether
 * any token sequence is accepted by both — and if so, return a concrete
 * witness.  Used by `@grammar collisions --full` to detect cross-agent
 * grammar collisions with a real proof of overlap rather than the static
 * anchor-based heuristic.
 *
 * Algorithm: BFS over the implicit product NFA.  States are pairs
 * (stateA, stateB); a step consumes the same input token sequence in both
 * NFAs simultaneously.  Epsilon transitions are taken independently in
 * either NFA (joint epsilon-closure).  When BFS reaches a pair where both
 * NFAs are in an accepting state, the path's accumulated tokens are a
 * witness.
 *
 * Limitations (deliberate, document in command output):
 * - Wildcards typed by custom entity validators don't have an enumerable
 *   accepted language — when both sides require disjoint custom types the
 *   intersection is treated as non-empty with a synthetic placeholder
 *   witness.  Inspect manually.
 * - Multi-token entity validation (`tryMultiTokenEntity` in the runtime
 *   matcher) is single-step at the NFA level; collisions that only emerge
 *   from multi-token spans are not detected.
 * - Multi-token phraseSet phrases only collide when both NFAs consume
 *   the same exact phrase (same tokens, same length).
 */

import { NFA, NFAState, NFATransition } from "./nfa.js";
import { globalEntityRegistry } from "./entityRegistry.js";
import { globalPhraseSetRegistry } from "./builtInPhraseMatchers.js";
import { normalizeToken } from "./nfaMatcher.js";

export interface GrammarOverlap {
    /** Token sequence accepted by both NFAs. */
    witness: string[];
    /**
     * `ruleIndex` of the top-level alternative reached in NFA A when the
     * witness was accepted.  Undefined for grammars where no rule entry
     * marker was crossed (unusual — typically every alternative is a rule).
     */
    ruleIndexA?: number | undefined;
    /** Same as `ruleIndexA` but for NFA B. */
    ruleIndexB?: number | undefined;
    /**
     * True if the witness contains synthetic placeholder tokens of the form
     * `<TypeName>` because at least one wildcard required a custom entity
     * type whose accepted language can't be enumerated by this scanner.
     * Callers should mark these results as needing manual inspection.
     */
    hasPlaceholders: boolean;
}

export interface FindOverlapOptions {
    /**
     * Cap witness length to bound search on grammars with cycles.
     * Default: 24 tokens — far longer than any natural action utterance,
     * but short enough that O(state²) BFS stays cheap.
     */
    maxWitnessTokens?: number;
}

/**
 * Find a token sequence accepted by both NFAs, or `undefined` if their
 * accepted languages are provably disjoint under this scanner's model.
 * BFS guarantees the witness is the shortest reachable in joint-product
 * edge count (which, since each consuming step yields at least one token,
 * is also a near-shortest witness in tokens).
 */
export function findGrammarOverlap(
    nfaA: NFA,
    nfaB: NFA,
    opts?: FindOverlapOptions,
): GrammarOverlap | undefined {
    const maxWitnessTokens = opts?.maxWitnessTokens ?? 24;

    const epsA = computeEpsilonClosures(nfaA);
    const epsB = computeEpsilonClosures(nfaB);
    const ruleOfA = computeRuleOfState(nfaA);
    const ruleOfB = computeRuleOfState(nfaB);

    type Node = {
        a: number;
        b: number;
        ruleA: number | undefined;
        ruleB: number | undefined;
        parent: Node | undefined;
        edgeTokens: string[]; // tokens consumed on the edge into this node
        edgeHasPlaceholder: boolean;
        depth: number; // total tokens consumed so far
    };

    const start: Node = {
        a: nfaA.startState,
        b: nfaB.startState,
        ruleA: undefined,
        ruleB: undefined,
        parent: undefined,
        edgeTokens: [],
        edgeHasPlaceholder: false,
        depth: 0,
    };

    // Visit by (a,b) pair only — BFS guarantees first-seen is shortest.
    const visited = new Set<string>([pairKey(start.a, start.b)]);
    const queue: Node[] = [start];

    while (queue.length > 0) {
        const node = queue.shift()!;

        // Joint epsilon-closure: any (a', b') reachable from (a,b) via ε-only
        // moves in either NFA.  Independence means the joint closure is the
        // cross product of the two single-NFA closures.
        const aReach = epsA.get(node.a) ?? new Set([node.a]);
        const bReach = epsB.get(node.b) ?? new Set([node.b]);

        // Acceptance check: any (a', b') in the joint closure where both are
        // accepting is a hit.  Prefer the rule attribution committed when
        // the BFS path entered the rule's body (`node.rule*`); the accept
        // state itself is typically shared across rules and so unattributed.
        for (const a2 of aReach) {
            if (!nfaA.states[a2].accepting) continue;
            for (const b2 of bReach) {
                if (nfaB.states[b2].accepting) {
                    return reconstruct(
                        node,
                        node.ruleA ?? ruleOfA.get(a2),
                        node.ruleB ?? ruleOfB.get(b2),
                    );
                }
            }
        }

        if (node.depth >= maxWitnessTokens) {
            continue;
        }

        // Enumerate consuming moves from any state in either closure.
        for (const a2 of aReach) {
            const stateA = nfaA.states[a2];
            if (!stateA) continue;
            for (const b2 of bReach) {
                const stateB = nfaB.states[b2];
                if (!stateB) continue;
                for (const move of enumerateConsumingMoves(stateA, stateB)) {
                    const key = pairKey(move.targetA, move.targetB);
                    if (visited.has(key)) continue;
                    visited.add(key);
                    queue.push({
                        a: move.targetA,
                        b: move.targetB,
                        // Attribute at the source state — typically the
                        // rule entry — because the rule's body is uniquely
                        // owned but its accept state is often shared with
                        // other rules.  Fall back to the target when the
                        // source is unattributed (e.g. the start state's
                        // closure for the very first transition).
                        ruleA:
                            node.ruleA ??
                            ruleOfA.get(a2) ??
                            ruleOfA.get(move.targetA),
                        ruleB:
                            node.ruleB ??
                            ruleOfB.get(b2) ??
                            ruleOfB.get(move.targetB),
                        parent: node,
                        edgeTokens: move.tokens,
                        edgeHasPlaceholder: move.hasPlaceholder,
                        depth: node.depth + move.tokens.length,
                    });
                }
            }
        }
    }

    return undefined;
}

function reconstruct(
    node: {
        parent: any;
        edgeTokens: string[];
        edgeHasPlaceholder: boolean;
    },
    ruleA: number | undefined,
    ruleB: number | undefined,
): GrammarOverlap {
    const tokens: string[] = [];
    let hasPlaceholders = false;
    let cur: any = node;
    while (cur) {
        if (cur.edgeTokens.length > 0) {
            tokens.unshift(...cur.edgeTokens);
        }
        if (cur.edgeHasPlaceholder) {
            hasPlaceholders = true;
        }
        cur = cur.parent;
    }
    return { witness: tokens, ruleIndexA: ruleA, ruleIndexB: ruleB, hasPlaceholders };
}

function pairKey(a: number, b: number): string {
    return `${a},${b}`;
}

/**
 * Per-NFA epsilon-closure cache: stateId → set of states reachable from it
 * via epsilon transitions only.  Computed once up front to keep the BFS
 * inner loop free of repeated graph traversal.
 *
 * Note: this scanner ignores the rule-environment side-effects (slot writes,
 * pop, write-to-parent) that the runtime matcher performs on epsilon edges.
 * Those affect *what* a rule captures, not *whether* the rule accepts a
 * given input — so they're irrelevant to language-overlap detection.
 */
function computeEpsilonClosures(nfa: NFA): Map<number, Set<number>> {
    const cache = new Map<number, Set<number>>();
    for (const s of nfa.states) {
        const reach = new Set<number>([s.id]);
        const stack = [s.id];
        while (stack.length > 0) {
            const cur = stack.pop()!;
            const st = nfa.states[cur];
            if (!st) continue;
            for (const t of st.transitions) {
                if (t.type === "epsilon" && !reach.has(t.to)) {
                    reach.add(t.to);
                    stack.push(t.to);
                }
            }
        }
        cache.set(s.id, reach);
    }
    return cache;
}

/**
 * Pre-compute, for each NFA state, which top-level rule *uniquely* owns it.
 * `nfaState.ruleIndex` is only set on the rule's *entry* state; we
 * forward-walk from each rule entry to find every reachable state, then
 * keep an entry in the map only when exactly one rule entry can reach a
 * given state without crossing another rule's entry.  Shared states (e.g.
 * a single global accept state used by all rules) are deliberately left
 * unattributed so the caller falls back to path-based attribution.
 *
 * Why uniqueness matters: action-grammar NFAs commonly converge to a
 * single accept state.  Tagging that state with whichever rule visits it
 * first would silently mis-attribute every collision that lands on it.
 */
function computeRuleOfState(nfa: NFA): Map<number, number> {
    const reach = new Map<number, Set<number>>(); // stateId → set of rule entries that can reach it
    for (const entry of nfa.states) {
        if (entry.ruleIndex === undefined) continue;
        const ruleIndex = entry.ruleIndex;
        const visited = new Set<number>();
        const stack = [entry.id];
        while (stack.length > 0) {
            const cur = stack.pop()!;
            if (visited.has(cur)) continue;
            const target = nfa.states[cur];
            if (!target) continue;
            // Stop at other rules' entries — they own their subgraph.
            if (
                target.ruleIndex !== undefined &&
                target.ruleIndex !== ruleIndex
            ) {
                continue;
            }
            visited.add(cur);
            const owners = reach.get(cur) ?? new Set<number>();
            owners.add(ruleIndex);
            reach.set(cur, owners);
            for (const t of target.transitions) {
                if (!visited.has(t.to)) stack.push(t.to);
            }
        }
    }
    const result = new Map<number, number>();
    for (const [stateId, owners] of reach) {
        if (owners.size === 1) {
            result.set(stateId, owners.values().next().value!);
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Transition intersection: given a single transition pair (T_a, T_b), yield
// every concrete consuming move that satisfies both sides simultaneously.
// ---------------------------------------------------------------------------

type ConsumingMove = {
    tokens: string[]; // input tokens consumed (length 1 except for matched multi-token phrases)
    targetA: number;
    targetB: number;
    hasPlaceholder: boolean; // true if any token is a synthetic <TypeName> placeholder
};

function* enumerateConsumingMoves(
    stateA: NFAState,
    stateB: NFAState,
): Iterable<ConsumingMove> {
    for (const tA of stateA.transitions) {
        if (tA.type === "epsilon") continue;
        for (const tB of stateB.transitions) {
            if (tB.type === "epsilon") continue;
            yield* intersectTransitions(tA, tB);
        }
    }
}

function* intersectTransitions(
    tA: NFATransition,
    tB: NFATransition,
): Iterable<ConsumingMove> {
    // token ∩ token → tokens present in both alternative sets.
    if (tA.type === "token" && tB.type === "token") {
        const setB = normTokenSet(tB.tokens);
        for (const t of tA.tokens ?? []) {
            if (setB.has(normalizeToken(t))) {
                yield {
                    tokens: [t],
                    targetA: tA.to,
                    targetB: tB.to,
                    hasPlaceholder: false,
                };
            }
        }
        return;
    }

    // token ∩ wildcard (and mirror): the literal must validate against the
    // wildcard's typeName (or the wildcard is unconstrained).
    if (tA.type === "token" && tB.type === "wildcard") {
        for (const t of tA.tokens ?? []) {
            if (wildcardAcceptsLiteral(tB, t)) {
                yield {
                    tokens: [t],
                    targetA: tA.to,
                    targetB: tB.to,
                    hasPlaceholder: false,
                };
            }
        }
        return;
    }
    if (tA.type === "wildcard" && tB.type === "token") {
        for (const t of tB.tokens ?? []) {
            if (wildcardAcceptsLiteral(tA, t)) {
                yield {
                    tokens: [t],
                    targetA: tA.to,
                    targetB: tB.to,
                    hasPlaceholder: false,
                };
            }
        }
        return;
    }

    // wildcard ∩ wildcard → at least one shared token if their types overlap.
    // For unconstrained wildcards we use a generic stand-in; for typed ones
    // we pick a sample that validates against both, falling back to a
    // synthetic <type> placeholder when we can't compute a concrete one.
    if (tA.type === "wildcard" && tB.type === "wildcard") {
        const sample = wildcardIntersectSample(tA, tB);
        if (sample) {
            yield {
                tokens: [sample.token],
                targetA: tA.to,
                targetB: tB.to,
                hasPlaceholder: sample.placeholder,
            };
        }
        return;
    }

    // phraseSet ∩ token: only single-token phrases can collide with a single
    // token transition.  For each such phrase whose token is in the literal
    // set, emit a move.
    if (tA.type === "phraseSet" && tB.type === "token") {
        const matcher = getPhraseMatcher(tA.matcherName);
        if (!matcher) return;
        const setB = normTokenSet(tB.tokens);
        for (const phrase of matcher.phrases) {
            if (phrase.length !== 1) continue;
            if (setB.has(normalizeToken(phrase[0]))) {
                yield {
                    tokens: [phrase[0]],
                    targetA: tA.to,
                    targetB: tB.to,
                    hasPlaceholder: false,
                };
            }
        }
        return;
    }
    if (tA.type === "token" && tB.type === "phraseSet") {
        const matcher = getPhraseMatcher(tB.matcherName);
        if (!matcher) return;
        const setA = normTokenSet(tA.tokens);
        for (const phrase of matcher.phrases) {
            if (phrase.length !== 1) continue;
            if (setA.has(normalizeToken(phrase[0]))) {
                yield {
                    tokens: [phrase[0]],
                    targetA: tA.to,
                    targetB: tB.to,
                    hasPlaceholder: false,
                };
            }
        }
        return;
    }

    // phraseSet ∩ wildcard: wildcards consume a single token, so only
    // single-token phrases are eligible.
    if (tA.type === "phraseSet" && tB.type === "wildcard") {
        const matcher = getPhraseMatcher(tA.matcherName);
        if (!matcher) return;
        for (const phrase of matcher.phrases) {
            if (phrase.length !== 1) continue;
            if (wildcardAcceptsLiteral(tB, phrase[0])) {
                yield {
                    tokens: [phrase[0]],
                    targetA: tA.to,
                    targetB: tB.to,
                    hasPlaceholder: false,
                };
            }
        }
        return;
    }
    if (tA.type === "wildcard" && tB.type === "phraseSet") {
        const matcher = getPhraseMatcher(tB.matcherName);
        if (!matcher) return;
        for (const phrase of matcher.phrases) {
            if (phrase.length !== 1) continue;
            if (wildcardAcceptsLiteral(tA, phrase[0])) {
                yield {
                    tokens: [phrase[0]],
                    targetA: tA.to,
                    targetB: tB.to,
                    hasPlaceholder: false,
                };
            }
        }
        return;
    }

    // phraseSet ∩ phraseSet: both sides must consume the same phrase (same
    // tokens, same length) to land at their respective targets in lockstep.
    if (tA.type === "phraseSet" && tB.type === "phraseSet") {
        const matcherA = getPhraseMatcher(tA.matcherName);
        const matcherB = getPhraseMatcher(tB.matcherName);
        if (!matcherA || !matcherB) return;
        const phrasesB = new Map<string, string[]>();
        for (const p of matcherB.phrases) {
            phrasesB.set(p.map(normalizeToken).join(" "), p);
        }
        for (const p of matcherA.phrases) {
            const key = p.map(normalizeToken).join(" ");
            if (phrasesB.has(key)) {
                yield {
                    tokens: p,
                    targetA: tA.to,
                    targetB: tB.to,
                    hasPlaceholder: false,
                };
            }
        }
        return;
    }
}

function normTokenSet(toks: string[] | undefined): Set<string> {
    const s = new Set<string>();
    if (!toks) return s;
    for (const t of toks) s.add(normalizeToken(t));
    return s;
}

function getPhraseMatcher(
    name: string | undefined,
): { phrases: string[][] } | undefined {
    if (!name) return undefined;
    return globalPhraseSetRegistry.getMatcher(name);
}

/**
 * Does this wildcard transition accept the given literal token?  Mirrors
 * the runtime check in `tryTransition` — type-name dispatch through the
 * built-in `number` parser or the global entity validator registry, with
 * `string`/`wildcard`/`word` treated as unconstrained.
 */
function wildcardAcceptsLiteral(trans: NFATransition, token: string): boolean {
    if (!trans.typeName) return true;
    if (
        trans.typeName === "string" ||
        trans.typeName === "wildcard" ||
        trans.typeName === "word"
    ) {
        return true;
    }
    if (trans.typeName === "number") {
        return !Number.isNaN(parseFloat(token));
    }
    const validator = globalEntityRegistry.getValidator(trans.typeName);
    if (!validator) return false;
    return validator.validate(token);
}

/**
 * Pick a sample token that satisfies both wildcard transitions, or a
 * synthetic placeholder when both sides require custom entity types whose
 * accepted languages we can't enumerate.  The returned `placeholder` flag
 * propagates up so callers can mark the witness as approximate.
 */
function wildcardIntersectSample(
    a: NFATransition,
    b: NFATransition,
): { token: string; placeholder: boolean } | undefined {
    const aUnc = isUnconstrainedWildcard(a);
    const bUnc = isUnconstrainedWildcard(b);
    if (aUnc && bUnc) {
        return { token: "x", placeholder: false };
    }
    if (aUnc) {
        return concreteSample(b.typeName!) ?? {
            token: `<${b.typeName}>`,
            placeholder: true,
        };
    }
    if (bUnc) {
        return concreteSample(a.typeName!) ?? {
            token: `<${a.typeName}>`,
            placeholder: true,
        };
    }
    if (a.typeName === b.typeName) {
        return concreteSample(a.typeName!) ?? {
            token: `<${a.typeName}>`,
            placeholder: true,
        };
    }
    // Different custom types — try a sample of either side and check it
    // validates against the other.  If neither validates we still emit a
    // placeholder rather than declare no overlap, because validators may
    // accept overlapping tokens we can't enumerate.
    const sA = concreteSample(a.typeName!);
    if (sA && wildcardAcceptsLiteral(b, sA.token)) return sA;
    const sB = concreteSample(b.typeName!);
    if (sB && wildcardAcceptsLiteral(a, sB.token)) return sB;
    return {
        token: `<${a.typeName}∩${b.typeName}>`,
        placeholder: true,
    };
}

function isUnconstrainedWildcard(trans: NFATransition): boolean {
    if (!trans.typeName) return true;
    return (
        trans.typeName === "string" ||
        trans.typeName === "wildcard" ||
        trans.typeName === "word"
    );
}

/**
 * Concrete sample value for a known type, or undefined if we don't have
 * one.  `number` is the only built-in we can synthesize without consulting
 * a validator.  Custom entity types fall through to the placeholder path.
 */
function concreteSample(
    typeName: string,
): { token: string; placeholder: boolean } | undefined {
    if (typeName === "number") {
        return { token: "42", placeholder: false };
    }
    return undefined;
}
