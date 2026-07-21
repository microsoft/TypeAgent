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
import { sourceTargetFor } from "../traceSourceResolver.js";

const WORKING: VersionSpec = { kind: "workingTree" };

function range(startLine: number, endLine: number) {
    return {
        start: { line: startLine, character: 2, offset: 0 },
        end: { line: endLine, character: 8, offset: 0 },
    };
}

function side(nodes: ReplayTraceNode[]): ReplaySideTrace {
    return {
        side: "A",
        version: WORKING,
        realization: "built-live",
        nodes,
    } as ReplaySideTrace;
}

function trace(a: ReplaySideTrace, b: ReplaySideTrace): ReplayResolutionTrace {
    return {
        utterance: "play despacito",
        utteranceId: "u1",
        a,
        b,
    } as ReplayResolutionTrace;
}

test("resolves a grammar span from the node's debug-info file table", () => {
    const a = side([
        {
            kind: "grammar-match",
            execution: "ran",
            outcome: "hit",
            input: "play despacito",
            chosenRule: "PlayTrack",
            rankingParity: "matched",
            source: {
                fileId: "player.agr",
                displayPath: "player.agr",
                range: range(10, 10),
            },
            debugInfo: {
                grammarHash: "h",
                rules: [],
                parts: [],
                partRules: [],
                partLabels: [],
                filePaths: [["player.agr", "/repo/agents/player/player.agr"]],
            },
        },
    ]);
    const target = sourceTargetFor(trace(a, a), "a", "grammar-match");
    assert.deepEqual(target, {
        absPath: "/repo/agents/player/player.agr",
        range: {
            start: { line: 10, character: 2 },
            end: { line: 10, character: 8 },
        },
    });
});

test("falls back to the span display path when the file table lacks the id", () => {
    const a = side([
        {
            kind: "grammar-match",
            execution: "ran",
            outcome: "hit",
            input: "play despacito",
            chosenRule: "PlayTrack",
            rankingParity: "matched",
            source: {
                fileId: "player.agr",
                displayPath: "/abs/player.agr",
                range: range(3, 4),
            },
        },
    ]);
    const target = sourceTargetFor(trace(a, a), "a", "grammar-match");
    assert.equal(target?.absPath, "/abs/player.agr");
    assert.deepEqual(target?.range, {
        start: { line: 3, character: 2 },
        end: { line: 4, character: 8 },
    });
});

test("returns undefined when the grammar node recorded no source span", () => {
    const a = side([
        {
            kind: "grammar-match",
            execution: "ran",
            outcome: "hit",
            input: "play despacito",
            rankingParity: "unavailable",
        },
    ]);
    assert.equal(sourceTargetFor(trace(a, a), "a", "grammar-match"), undefined);
});

test("prefers the node's recorded sourceFilePath over the span file table", () => {
    const a = side([
        {
            kind: "grammar-match",
            execution: "ran",
            outcome: "hit",
            input: "play despacito",
            chosenRule: "PlayTrack",
            rankingParity: "matched",
            sourceFilePath: "/repo/agents/player/player.agr",
            source: {
                fileId: "player.agr",
                displayPath: "player.agr",
                range: range(10, 10),
            },
            debugInfo: {
                grammarHash: "h",
                rules: [],
                parts: [],
                partRules: [],
                partLabels: [],
                filePaths: [["player.agr", "/stale/other.agr"]],
            },
        },
    ]);
    const target = sourceTargetFor(trace(a, a), "a", "grammar-match");
    assert.deepEqual(target, {
        absPath: "/repo/agents/player/player.agr",
        range: {
            start: { line: 10, character: 2 },
            end: { line: 10, character: 8 },
        },
    });
});

test("yields the grammar file path without a range when the side matched no rule", () => {
    // The regressed side matched nothing, so there's no winning-rule span — but
    // the recorded absolute path still lets the host diff the file across A/B.
    const a = side([
        {
            kind: "grammar-match",
            execution: "ran",
            outcome: "miss",
            input: "resume",
            rankingParity: "unavailable",
            sourceFilePath: "/repo/agents/player/player.agr",
        },
    ]);
    assert.deepEqual(sourceTargetFor(trace(a, a), "a", "grammar-match"), {
        absPath: "/repo/agents/player/player.agr",
    });
});

test("resolves an action schema file with no range", () => {
    const a = side([
        {
            kind: "action",
            execution: "ran",
            outcome: "hit",
            action: { actionName: "play" },
            schema: {
                sourceFilePath: "/repo/agents/player/playerSchema.ts",
                actionName: "play",
            },
        },
    ]);
    const target = sourceTargetFor(trace(a, a), "a", "action");
    assert.deepEqual(target, {
        absPath: "/repo/agents/player/playerSchema.ts",
    });
});

test("returns undefined when the action node has no schema file", () => {
    const a = side([
        {
            kind: "action",
            execution: "ran",
            outcome: "hit",
            action: { actionName: "play" },
        },
    ]);
    assert.equal(sourceTargetFor(trace(a, a), "a", "action"), undefined);
});

test("reads the requested side independently", () => {
    const a = side([
        {
            kind: "action",
            execution: "ran",
            outcome: "hit",
            schema: { sourceFilePath: "/a/schema.ts" },
        },
    ]);
    const b = side([
        {
            kind: "action",
            execution: "ran",
            outcome: "hit",
            schema: { sourceFilePath: "/b/schema.ts" },
        },
    ]);
    assert.equal(
        sourceTargetFor(trace(a, b), "a", "action")?.absPath,
        "/a/schema.ts",
    );
    assert.equal(
        sourceTargetFor(trace(a, b), "b", "action")?.absPath,
        "/b/schema.ts",
    );
});
