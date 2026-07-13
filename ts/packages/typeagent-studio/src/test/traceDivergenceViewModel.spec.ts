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
    } = {},
): ReplaySideTrace {
    const cacheHit = overrides.cacheHit ?? false;
    const grammarReached = !cacheHit;
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
            rankingParity: overrides.rankingParity ?? "matched",
            ...((overrides.hasTrace ?? true) && grammarReached
                ? {
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
            schema: { sourceFilePath: "player.ts", actionName: "play" },
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
            schema: { sourceFilePath: "player.ts", actionName: "play" },
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
