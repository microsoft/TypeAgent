// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import type {
    ReplayResolutionTrace,
    ReplaySideTrace,
    ReplayTraceNode,
    VersionSpec,
} from "@typeagent/core/replay";
import { toTraceDivergenceViewModel } from "../webviewKit/traceDivergenceViewModel.js";

const GIT: VersionSpec = { kind: "git", ref: "HEAD" };
const WORKING: VersionSpec = { kind: "workingTree" };

/** A working-tree side that resolved through its grammar to `action`, matching
 *  the rule `chosenRule`. Cache consulted and missed; wildcard validation ran
 *  and accepted. */
function liveSide(
    side: "A" | "B",
    action: unknown,
    chosenRule: string,
    overrides: {
        cacheHit?: boolean;
        wildcardRejected?: boolean;
        rankingParity?: "matched" | "diverged" | "unavailable";
        hasTrace?: boolean;
        grammarHash?: string;
        grammarFilePath?: string;
        ruleLocations?: Array<
            [string, { fileId: string; displayPath: string }]
        >;
        filePaths?: Array<[string, string]>;
    } = {},
): ReplaySideTrace {
    const cacheHit = overrides.cacheHit ?? false;
    const grammarReached = !cacheHit;
    const zeroPos = { line: 0, character: 0, offset: 0 };
    const zeroRange = { start: zeroPos, end: zeroPos };
    const nodes: ReplayTraceNode[] = [
        {
            kind: "cache-consult",
            execution: "ran",
            outcome: cacheHit ? "hit" : "miss",
            ...(cacheHit
                ? {
                      entry: {
                          action,
                          constructionId: "c-1",
                          namespace: "player",
                          parts: ["play", "<song>"],
                      },
                  }
                : {}),
        },
        {
            kind: "grammar-match",
            execution: grammarReached ? "ran" : "not-reached",
            ...(grammarReached ? { outcome: "hit" as const } : {}),
            input: "play something",
            chosenRule,
            ...(overrides.grammarFilePath !== undefined
                ? { sourceFilePath: overrides.grammarFilePath }
                : {}),
            rankingParity: overrides.rankingParity ?? "matched",
            ...((overrides.hasTrace ?? true) && grammarReached
                ? {
                      trace: {
                          input: "play something",
                          events: [],
                          result: "matched" as const,
                      },
                      debugInfo: {
                          grammarHash: overrides.grammarHash ?? "h",
                          rules: (overrides.ruleLocations ?? []).map(
                              ([id, loc]) => [
                                  id,
                                  {
                                      fileId: loc.fileId,
                                      displayPath: loc.displayPath,
                                      range: zeroRange,
                                  },
                              ],
                          ),
                          parts: [],
                          partRules: [],
                          partLabels: [],
                          filePaths: overrides.filePaths ?? [],
                      },
                  }
                : {}),
        },
        {
            kind: "wildcard-validation",
            execution: "ran",
            outcome: overrides.wildcardRejected ? "rejected" : "accepted",
        },
        {
            kind: "action",
            execution: grammarReached || cacheHit ? "ran" : "not-reached",
            outcome: "hit",
            action,
            schema: { sourceFilePath: "/repo/player.ts", actionName: "play" },
        },
    ];
    return {
        side,
        version: WORKING,
        realization: "built-live",
        nodes,
        finalAction: action,
        cacheState: cacheHit ? "hit" : "miss",
    };
}

/** A git-ref side: grammar text only, so cache + wildcard validation are
 *  not-applicable. */
function refSide(
    side: "A" | "B",
    action: unknown,
    chosenRule: string,
): ReplaySideTrace {
    const nodes: ReplayTraceNode[] = [
        {
            kind: "cache-consult",
            execution: "not-applicable",
            detail: "The construction cache runs only on the working tree.",
        },
        {
            kind: "grammar-match",
            execution: "ran",
            outcome: "hit",
            input: "play something",
            chosenRule,
            rankingParity: "matched",
            trace: {
                input: "play something",
                events: [],
                result: "matched" as const,
            },
            debugInfo: {
                grammarHash: "h",
                rules: [],
                parts: [],
                partRules: [],
                partLabels: [],
                filePaths: [],
            },
        },
        {
            kind: "wildcard-validation",
            execution: "not-applicable",
        },
        {
            kind: "action",
            execution: "ran",
            outcome: "hit",
            action,
            schema: { sourceFilePath: "/repo/player.ts", actionName: "play" },
        },
    ];
    return {
        side,
        version: GIT,
        realization: "source",
        nodes,
        finalAction: action,
        cacheState: "miss",
    };
}

function trace(a: ReplaySideTrace, b: ReplaySideTrace): ReplayResolutionTrace {
    return {
        runId: "run-1",
        utteranceId: "u-1",
        utterance: "play something",
        a,
        b,
        capturedAt: 0,
    };
}

test("matching actions on both live sides reads as parity, high confidence", () => {
    const action = { actionName: "play", parameters: { song: "x" } };
    const vm = toTraceDivergenceViewModel(
        trace(liveSide("A", action, "Play"), liveSide("B", action, "Play")),
    );
    assert.equal(vm.conclusion.parity, "match");
    assert.equal(vm.conclusion.bothNoAction, false);
    assert.equal(vm.conclusion.confidence, "high");
    assert.equal(
        vm.conclusion.headline,
        "Both versions produced the same action.",
    );
    assert.equal(vm.conclusion.cause, undefined);
    assert.equal(vm.divergingLayer, undefined);
    assert.equal(vm.conclusion.pathNote, undefined);
});

test("neither side produces an action reads as bothNoAction", () => {
    const a: ReplaySideTrace = {
        side: "A",
        version: WORKING,
        realization: "built-live",
        nodes: [
            { kind: "cache-consult", execution: "ran", outcome: "miss" },
            {
                kind: "grammar-match",
                execution: "ran",
                outcome: "miss",
                input: "zzz",
                rankingParity: "unavailable",
            },
            { kind: "wildcard-validation", execution: "not-reached" },
            { kind: "action", execution: "not-reached" },
        ],
        cacheState: "miss",
    };
    const b: ReplaySideTrace = { ...a, side: "B" };
    const vm = toTraceDivergenceViewModel(trace(a, b));
    assert.equal(vm.conclusion.parity, "match");
    assert.equal(vm.conclusion.bothNoAction, true);
    assert.match(vm.conclusion.headline, /Neither version resolved/);
});

test("matching actions with a git-ref side surfaces a fidelity-path note", () => {
    const action = { actionName: "play", parameters: { song: "x" } };
    const vm = toTraceDivergenceViewModel(
        trace(refSide("A", action, "Play"), liveSide("B", action, "Play")),
    );
    assert.equal(vm.conclusion.parity, "match");
    assert.ok(vm.conclusion.pathNote);
    assert.match(vm.conclusion.pathNote!, /A ran from grammar source only/);
});

test("different rules attribute the difference to grammar match", () => {
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide("A", { actionName: "play" }, "Play"),
            liveSide("B", { actionName: "queue" }, "Queue"),
        ),
    );
    assert.equal(vm.conclusion.parity, "differ");
    assert.equal(vm.conclusion.cause?.kind, "grammar-differs");
    assert.equal(vm.divergingLayer, "grammar-match");
    assert.equal(vm.conclusion.confidence, "high");
    assert.match(
        vm.conclusion.cause!.detail,
        /A matched Play, B matched Queue/,
    );
});

test("a cache short-circuit on one side attributes to the cache", () => {
    const cachedAction = { actionName: "play", parameters: { song: "cached" } };
    const grammarAction = { actionName: "play", parameters: { song: "fresh" } };
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide("A", cachedAction, "Play", { cacheHit: true }),
            liveSide("B", grammarAction, "Play"),
        ),
    );
    assert.equal(vm.conclusion.parity, "differ");
    assert.equal(vm.conclusion.cause?.kind, "cache-decided");
    assert.equal(vm.conclusion.cause?.side, "A");
    assert.equal(vm.divergingLayer, "cache-consult");
});

test("same rule with a one-sided wildcard rejection attributes to validation", () => {
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide(
                "A",
                { actionName: "play", parameters: { q: "a" } },
                "Play",
            ),
            liveSide(
                "B",
                { actionName: "play", parameters: { q: "b" } },
                "Play",
                { wildcardRejected: true },
            ),
        ),
    );
    assert.equal(vm.conclusion.cause?.kind, "wildcard-validation");
    assert.equal(vm.conclusion.cause?.side, "B");
    assert.equal(vm.divergingLayer, "wildcard-validation");
});

test("same rule with differing parameters falls back to action-payload", () => {
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide(
                "A",
                { actionName: "play", parameters: { song: "a" } },
                "Play",
            ),
            liveSide(
                "B",
                { actionName: "play", parameters: { song: "b" } },
                "Play",
            ),
        ),
    );
    assert.equal(vm.conclusion.cause?.kind, "action-payload");
    assert.equal(vm.divergingLayer, "action");
    assert.equal(vm.conclusion.confidence, "high");
    assert.match(vm.conclusion.cause!.detail, /parameters differ/);
});

test("a diverged grammar parity demotes attribution to low confidence", () => {
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide(
                "A",
                { actionName: "play", parameters: { song: "a" } },
                "Play",
                {
                    rankingParity: "diverged",
                },
            ),
            liveSide(
                "B",
                { actionName: "play", parameters: { song: "b" } },
                "Queue",
            ),
        ),
    );
    assert.equal(vm.conclusion.parity, "differ");
    // Grammar level is untrusted, so it must NOT claim grammar-differs.
    assert.notEqual(vm.conclusion.cause?.kind, "grammar-differs");
    assert.equal(vm.conclusion.confidence, "low");
    assert.ok(vm.conclusion.confidenceNote);
});

test("a diverged parse with a differing grammar hash still blames the grammar", () => {
    // The compiled-grammar hash is resolver-independent, so a genuine grammar
    // change is named even when one side's diagnostic parse diverged. Two
    // utterances carrying the same change must not flip between grammar- and
    // action-level attribution just because their parses took different paths.
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide(
                "A",
                { actionName: "play", parameters: { song: "a" } },
                "Play",
                {
                    rankingParity: "diverged",
                    grammarHash: "h1",
                },
            ),
            liveSide(
                "B",
                { actionName: "play", parameters: { song: "a", album: "x" } },
                "Play",
                {
                    grammarHash: "h2",
                },
            ),
        ),
    );
    assert.equal(vm.conclusion.cause?.kind, "grammar-differs");
    assert.equal(vm.divergingLayer, "grammar-match");
    assert.equal(vm.conclusion.confidence, "high");
});

test("node summaries carry grammar, cache, and action extras", () => {
    const cachedAction = { actionName: "play", parameters: { song: "cached" } };
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide("A", cachedAction, "Play", { cacheHit: true }),
            liveSide("B", { actionName: "play" }, "Play"),
        ),
    );

    // Side A: cache hit → cache node carries the inline entry.
    const aCache = vm.a.nodes.find((n) => n.kind === "cache-consult");
    assert.equal(aCache?.outcomeLabel, "hit");
    assert.equal(aCache?.cache?.constructionId, "c-1");
    assert.deepEqual(aCache?.cache?.parts, ["play", "<song>"]);

    // Side B: grammar ran with a trace → timeline available, parse matches pick.
    const bGrammar = vm.b.nodes.find((n) => n.kind === "grammar-match");
    assert.equal(bGrammar?.grammar?.chosenRule, "Play");
    assert.equal(bGrammar?.grammar?.hasTimeline, true);
    assert.equal(bGrammar?.grammar?.diagnosticOnly, false);
    assert.equal(bGrammar?.grammar?.rankingParityLabel, "parse matches pick");

    // Action node exposes the produced action's name and schema availability.
    const bAction = vm.b.nodes.find((n) => n.kind === "action");
    assert.equal(bAction?.action?.actionName, "play");
    assert.equal(bAction?.action?.hasSchema, true);

    // Nodes are emitted in canonical layer order.
    assert.deepEqual(
        vm.a.nodes.map((n) => n.kind),
        ["cache-consult", "grammar-match", "wildcard-validation", "action"],
    );
});

test("not-applicable git-ref layers are labelled, not read as failures", () => {
    const vm = toTraceDivergenceViewModel(
        trace(
            refSide("A", { actionName: "play" }, "Play"),
            liveSide("B", { actionName: "play" }, "Play"),
        ),
    );
    const aCache = vm.a.nodes.find((n) => n.kind === "cache-consult");
    assert.equal(aCache?.executionLabel, "not applicable");
    assert.equal(aCache?.outcomeLabel, undefined);
});

test("the pipeline lists the engaged stages in runtime order", () => {
    const action = { actionName: "play", parameters: { song: "x" } };
    const vm = toTraceDivergenceViewModel(
        trace(liveSide("A", action, "Play"), liveSide("B", action, "Play")),
    );
    assert.deepEqual(
        vm.stages.map((s) => s.kind),
        ["cache-consult", "grammar-match", "wildcard-validation", "action"],
    );
    // Matching actions: no stage is the attributed cause.
    assert.equal(
        vm.stages.some((s) => s.isCause),
        false,
    );
    // Both sides ran every stage → all agree.
    assert.deepEqual(
        vm.stages.map((s) => s.status),
        ["agree", "agree", "agree", "agree"],
    );
    // Both sides' nodes are paired onto each stage for side-by-side rendering.
    assert.equal(
        vm.stages.every((s) => s.a !== undefined && s.b !== undefined),
        true,
    );
});

test("the diverging grammar stage is the sole cause; the rest agree", () => {
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide("A", { actionName: "play" }, "Play"),
            liveSide("B", { actionName: "queue" }, "Queue"),
        ),
    );
    assert.deepEqual(
        vm.stages.filter((s) => s.isCause).map((s) => s.kind),
        ["grammar-match"],
    );
    const grammar = vm.stages.find((s) => s.kind === "grammar-match");
    assert.equal(grammar?.status, "diverge");
    assert.ok(grammar?.a);
    assert.ok(grammar?.b);
    // Layers that ran on both sides but aren't the cause read as agreement.
    assert.equal(
        vm.stages.find((s) => s.kind === "cache-consult")?.status,
        "agree",
    );
    assert.equal(vm.stages.find((s) => s.kind === "action")?.status, "agree");
});

test("a cache short-circuit is the cause and leaves the other grammar one-sided", () => {
    const cachedAction = { actionName: "play", parameters: { song: "cached" } };
    const grammarAction = { actionName: "play", parameters: { song: "fresh" } };
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide("A", cachedAction, "Play", { cacheHit: true }),
            liveSide("B", grammarAction, "Play"),
        ),
    );
    const cache = vm.stages.find((s) => s.kind === "cache-consult");
    assert.equal(cache?.isCause, true);
    assert.equal(cache?.status, "diverge");
    // A short-circuited through its cache so its grammar never ran; B's did.
    const grammar = vm.stages.find((s) => s.kind === "grammar-match");
    assert.equal(grammar?.status, "one-sided");
});

test("the action stage exposes a schema compare handle", () => {
    const action = { actionName: "play", parameters: { song: "x" } };
    const vm = toTraceDivergenceViewModel(
        trace(liveSide("A", action, "Play"), liveSide("B", action, "Play")),
    );
    assert.equal(vm.stages.find((s) => s.kind === "action")?.compare, "action");
    // The grammar fixtures carry no source span → no grammar compare handle.
    assert.equal(
        vm.stages.find((s) => s.kind === "grammar-match")?.compare,
        undefined,
    );
});

test("a grammar rule with a source span exposes a grammar compare handle", () => {
    const withSource = (side: "A" | "B", rule: string): ReplaySideTrace => ({
        side,
        version: WORKING,
        realization: "built-live",
        nodes: [
            { kind: "cache-consult", execution: "ran", outcome: "miss" },
            {
                kind: "grammar-match",
                execution: "ran",
                outcome: "hit",
                input: "play something",
                chosenRule: rule,
                rankingParity: "matched",
                source: {
                    fileId: "f1",
                    displayPath: "/repo/player.agr",
                    range: {
                        start: { line: 1, character: 0, offset: 0 },
                        end: { line: 1, character: 4, offset: 4 },
                    },
                },
            },
            {
                kind: "action",
                execution: "ran",
                outcome: "hit",
                action: { actionName: rule.toLowerCase() },
                schema: {
                    sourceFilePath: "/repo/player.ts",
                    actionName: rule.toLowerCase(),
                },
            },
        ],
        finalAction: { actionName: rule.toLowerCase() },
        cacheState: "miss",
    });
    const vm = toTraceDivergenceViewModel(
        trace(withSource("A", "Play"), withSource("B", "Queue")),
    );
    assert.equal(
        vm.stages.find((s) => s.kind === "grammar-match")?.compare,
        "grammar-match",
    );
    // Neither side captured wildcard validation → it's omitted from the flow.
    assert.equal(
        vm.stages.some((s) => s.kind === "wildcard-validation"),
        false,
    );
});

test("a side that missed grammar still exposes the compare handle via its recorded path", () => {
    // The `resume`-style regression: A matched a rule, B matched nothing. B has
    // no winning-rule span, but both sides record the absolute .agr path, so the
    // diverging grammar stage is still diffable across A ↔ B.
    const matched: ReplaySideTrace = {
        side: "A",
        version: WORKING,
        realization: "built-live",
        nodes: [
            { kind: "cache-consult", execution: "ran", outcome: "miss" },
            {
                kind: "grammar-match",
                execution: "ran",
                outcome: "hit",
                input: "resume",
                chosenRule: "Resume",
                rankingParity: "matched",
                sourceFilePath: "/repo/agents/player/player.agr",
                source: {
                    fileId: "f1",
                    displayPath: "player.agr",
                    range: {
                        start: { line: 5, character: 0, offset: 0 },
                        end: { line: 5, character: 6, offset: 6 },
                    },
                },
            },
            {
                kind: "wildcard-validation",
                execution: "ran",
                outcome: "accepted",
            },
            {
                kind: "action",
                execution: "ran",
                outcome: "hit",
                action: { actionName: "resume" },
                schema: {
                    sourceFilePath: "/repo/player.ts",
                    actionName: "resume",
                },
            },
        ],
        finalAction: { actionName: "resume" },
        cacheState: "miss",
    };
    const missed: ReplaySideTrace = {
        side: "B",
        version: WORKING,
        realization: "built-live",
        nodes: [
            { kind: "cache-consult", execution: "ran", outcome: "miss" },
            {
                kind: "grammar-match",
                execution: "ran",
                outcome: "miss",
                input: "resume",
                rankingParity: "unavailable",
                sourceFilePath: "/repo/agents/player/player.agr",
            },
            { kind: "action", execution: "not-reached" },
        ],
        cacheState: "miss",
    };
    const vm = toTraceDivergenceViewModel(trace(matched, missed));
    assert.equal(vm.divergingLayer, "grammar-match");
    const grammar = vm.stages.find((s) => s.kind === "grammar-match");
    assert.equal(grammar?.isCause, true);
    assert.equal(grammar?.compare, "grammar-match");
    // The missed side records the absolute path even with no winning-rule span.
    assert.equal(grammar?.b?.grammar?.hasSource, true);
});

test("a git-ref side's live-only stages read as one-sided, not divergent", () => {
    const action = { actionName: "play", parameters: { song: "x" } };
    const vm = toTraceDivergenceViewModel(
        trace(refSide("A", action, "Play"), liveSide("B", action, "Play")),
    );
    // Actions match → no stage is the cause.
    assert.equal(
        vm.stages.some((s) => s.isCause),
        false,
    );
    // Cache + wildcard validation ran only on the live side.
    assert.equal(
        vm.stages.find((s) => s.kind === "cache-consult")?.status,
        "one-sided",
    );
    assert.equal(
        vm.stages.find((s) => s.kind === "wildcard-validation")?.status,
        "one-sided",
    );
    // Grammar + action ran on both sides → agreement.
    assert.equal(
        vm.stages.find((s) => s.kind === "grammar-match")?.status,
        "agree",
    );
    assert.equal(vm.stages.find((s) => s.kind === "action")?.status, "agree");
});

test("a same-rule grammar-hash change still attributes to the grammar", () => {
    // Both sides matched `Play`, but the compiled grammar hash differs — a rule
    // body edit the rule-name comparison alone would miss. It's still the cause,
    // and the copy speaks to the file changing rather than a rule swap.
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide(
                "A",
                { actionName: "play", parameters: { song: "a" } },
                "Play",
                {
                    grammarHash: "h1",
                },
            ),
            liveSide(
                "B",
                { actionName: "play", parameters: { song: "b" } },
                "Play",
                {
                    grammarHash: "h2",
                },
            ),
        ),
    );
    assert.equal(vm.conclusion.cause?.kind, "grammar-differs");
    assert.equal(vm.divergingLayer, "grammar-match");
    assert.equal(vm.conclusion.confidence, "high");
    assert.match(
        vm.conclusion.cause!.detail,
        /changed between the two versions/,
    );
});

test("a grammar divergence names the changed .agr file and stays diffable", () => {
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide("A", { actionName: "play" }, "Play", {
                grammarFilePath: "/repo/agents/player/player.agr",
            }),
            liveSide("B", { actionName: "queue" }, "Queue", {
                grammarFilePath: "/repo/agents/player/player.agr",
            }),
        ),
    );
    assert.equal(vm.conclusion.cause?.kind, "grammar-differs");
    assert.equal(vm.conclusion.cause?.fileName, "player.agr");
    assert.match(vm.conclusion.cause!.detail, /player\.agr/);
    // The named file is diffable from the diverging grammar stage.
    assert.equal(
        vm.stages.find((s) => s.kind === "grammar-match")?.compare,
        "grammar-match",
    );
});

test("a grammar divergence pinpoints the file defining the matched rule", () => {
    // A's matched rule is defined in an imported grammar file; rule-level
    // attribution names that file, not the top-level grammar, so a multi-file
    // edit points at the one file on the match path.
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide("A", { actionName: "play" }, "Play", {
                grammarFilePath: "/repo/agents/player/player.agr",
                ruleLocations: [
                    [
                        "Play",
                        {
                            fileId: "player/commands.agr",
                            displayPath: "player/commands.agr",
                        },
                    ],
                ],
                filePaths: [
                    ["player/commands.agr", "/repo/agents/player/commands.agr"],
                ],
            }),
            liveSide("B", { actionName: "queue" }, "Queue", {
                grammarFilePath: "/repo/agents/player/player.agr",
            }),
        ),
    );
    assert.equal(vm.conclusion.cause?.kind, "grammar-differs");
    assert.equal(vm.conclusion.cause?.fileName, "commands.agr");
});

test("an action-payload divergence names the action schema file", () => {
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide(
                "A",
                { actionName: "play", parameters: { song: "a" } },
                "Play",
            ),
            liveSide(
                "B",
                { actionName: "play", parameters: { song: "b" } },
                "Play",
            ),
        ),
    );
    assert.equal(vm.conclusion.cause?.kind, "action-payload");
    assert.equal(vm.conclusion.cause?.fileName, "player.ts");
});
test("resultDiff reports identical actions as identical", () => {
    const action = { actionName: "play", parameters: { song: "x" } };
    const vm = toTraceDivergenceViewModel(
        trace(liveSide("A", action, "Play"), liveSide("B", action, "Play")),
    );
    assert.equal(vm.resultDiff.identical, true);
    assert.equal(vm.resultDiff.onlyA, false);
    assert.equal(vm.resultDiff.onlyB, false);
});

test("resultDiff flags an action produced on only one side as onlyA", () => {
    // A resolved `resume`; B produced nothing — the divergence the Result chip
    // must read as a lost match, never as "same".
    const a = liveSide("A", { actionName: "resume" }, "Resume");
    const b: ReplaySideTrace = {
        side: "B",
        version: WORKING,
        realization: "built-live",
        nodes: [
            { kind: "cache-consult", execution: "ran", outcome: "miss" },
            {
                kind: "grammar-match",
                execution: "ran",
                outcome: "miss",
                input: "resume",
                rankingParity: "unavailable",
            },
            { kind: "action", execution: "not-reached" },
        ],
        cacheState: "miss",
    };
    const vm = toTraceDivergenceViewModel(trace(a, b));
    assert.equal(vm.resultDiff.identical, false);
    assert.equal(vm.resultDiff.onlyA, true);
    assert.equal(vm.resultDiff.onlyB, false);
});

test("resultDiff reports two differing actions as a non-identical diff", () => {
    const vm = toTraceDivergenceViewModel(
        trace(
            liveSide(
                "A",
                { actionName: "play", parameters: { song: "a" } },
                "Play",
            ),
            liveSide(
                "B",
                { actionName: "play", parameters: { song: "b" } },
                "Play",
            ),
        ),
    );
    assert.equal(vm.resultDiff.identical, false);
    assert.equal(vm.resultDiff.onlyA, false);
    assert.equal(vm.resultDiff.onlyB, false);
    assert.ok(vm.resultDiff.lines.length > 0);
});
