// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import type {
    ReplayResolutionTrace,
    ReplayRunDescriptor,
    ReplaySideTrace,
    SerializedGrammarDebugInfo,
} from "@typeagent/core/replay";
import {
    loadResolutionTrace,
    loadTraceRun,
    saveTraceRun,
} from "../traceStore.js";

/** A minimal in-memory Memento mirroring VS Code's workspaceState. */
function fakeMemento(): vscode.Memento & { raw: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    return {
        keys(): readonly string[] {
            return [...store.keys()];
        },
        get<T>(key: string): T | undefined {
            return store.get(key) as T | undefined;
        },
        async update(key: string, value: unknown): Promise<void> {
            if (value === undefined) {
                store.delete(key);
            } else {
                store.set(key, value);
            }
        },
        // Inspection handle for tests to assert on the stored shape directly.
        raw: store,
    } as vscode.Memento & { raw: Map<string, unknown> };
}

function debugInfo(hash: string): SerializedGrammarDebugInfo {
    return {
        grammarHash: hash,
        rules: [["rule.play" as never, { displayPath: "player.agr" } as never]],
        parts: [],
        partRules: [],
        partLabels: [],
        filePaths: [["player.agr", "/repo/player.agr"]],
    };
}

function side(
    label: "A" | "B",
    hash: string,
    action: unknown,
): ReplaySideTrace {
    return {
        side: label,
        version: { kind: "workingTree" },
        realization: "built-live",
        nodes: [
            {
                kind: "grammar-match",
                execution: "ran",
                outcome: "hit",
                input: "play despacito",
                debugInfo: debugInfo(hash),
                rankingParity: "matched",
            },
            { kind: "action", execution: "ran", outcome: "hit", action },
        ],
        finalAction: action,
        cacheState: "not-consulted",
    } as unknown as ReplaySideTrace;
}

function trace(
    utteranceId: string,
    hash: string,
    runId = "run-1",
): ReplayResolutionTrace {
    return {
        runId,
        utteranceId,
        utterance: `utterance ${utteranceId}`,
        a: side("A", hash, { actionName: "playTrack", a: 1 }),
        b: side("B", hash, { actionName: "playTrack", b: 2 }),
        capturedAt: 100,
    };
}

function descriptor(runId: string, agent: string): ReplayRunDescriptor {
    return {
        runId,
        agent,
        a: {
            spec: { kind: "workingTree" },
            label: "working tree",
            workingTree: true,
        },
        b: {
            spec: { kind: "git", ref: "HEAD" },
            label: "HEAD",
            workingTree: false,
            sha: "abc123",
        },
        mode: "nfa-grammar",
        missPolicy: "needs-explanation",
        validateWildcards: false,
        corpus: {},
        runAt: 1,
    };
}

test("saveTraceRun round-trips a run's traces and descriptor", async () => {
    const state = fakeMemento();
    await saveTraceRun(state, descriptor("run-1", "player"), [
        trace("u1", "h1"),
        trace("u2", "h1"),
    ]);

    const lookup = loadTraceRun(state, "run-1");
    assert.equal(lookup.status, "present");
    if (lookup.status !== "present") return;
    assert.equal(lookup.descriptor.agent, "player");
    assert.equal(lookup.traces.length, 2);
    const u1 = lookup.traces.find((t) => t.utteranceId === "u1");
    assert.ok(u1);
    const node = u1.a.nodes.find((n) => n.kind === "grammar-match");
    assert.ok(node && node.kind === "grammar-match");
    // Debug info is rehydrated back onto the node from the deduped table.
    assert.equal(node.debugInfo?.grammarHash, "h1");
    assert.equal(node.debugInfo?.rules.length, 1);
});

test("debug info is deduped to one blob per grammar hash", async () => {
    const state = fakeMemento();
    await saveTraceRun(state, descriptor("run-1", "player"), [
        trace("u1", "h1"),
        trace("u2", "h1"),
        trace("u3", "h2"),
    ]);
    const stored = state.raw.get("traceRun.run-1") as {
        debugInfos: Record<string, unknown>;
    };
    // Two distinct grammar hashes across three rows / six sides → two blobs.
    assert.deepEqual(Object.keys(stored.debugInfos).sort(), ["h1", "h2"]);
});

test("loadResolutionTrace returns a single rehydrated row", async () => {
    const state = fakeMemento();
    await saveTraceRun(state, descriptor("run-1", "player"), [
        trace("u1", "h1"),
        trace("u2", "h2"),
    ]);
    const hit = loadResolutionTrace(state, "run-1", "u2");
    assert.ok(hit);
    assert.equal(hit.trace.utteranceId, "u2");
    const node = hit.trace.b.nodes.find((n) => n.kind === "grammar-match");
    assert.ok(node && node.kind === "grammar-match");
    assert.equal(node.debugInfo?.grammarHash, "h2");
    assert.equal(loadResolutionTrace(state, "run-1", "nope"), undefined);
});

test("a new run for an agent evicts the agent's previous run", async () => {
    const state = fakeMemento();
    await saveTraceRun(state, descriptor("run-1", "player"), [
        trace("u1", "h1"),
    ]);
    await saveTraceRun(state, descriptor("run-2", "player"), [
        trace("u1", "h1", "run-2"),
    ]);

    // The superseded run reads back as evicted (it was recorded, then rotated).
    assert.equal(loadTraceRun(state, "run-1").status, "evicted");
    assert.equal(loadTraceRun(state, "run-2").status, "present");
});

test("runs for different agents are retained independently", async () => {
    const state = fakeMemento();
    await saveTraceRun(state, descriptor("run-1", "player"), [
        trace("u1", "h1"),
    ]);
    await saveTraceRun(state, descriptor("run-2", "list"), [
        trace("u1", "h1", "run-2"),
    ]);
    assert.equal(loadTraceRun(state, "run-1").status, "present");
    assert.equal(loadTraceRun(state, "run-2").status, "present");
});

test("a never-stored run reads back as missing", () => {
    const state = fakeMemento();
    assert.equal(loadTraceRun(state, "ghost").status, "missing");
});

test("the global cap evicts the oldest runs", async () => {
    const state = fakeMemento();
    // Nine distinct agents; the cap keeps the eight most recent runs.
    for (let i = 1; i <= 9; i++) {
        await saveTraceRun(state, descriptor(`run-${i}`, `agent-${i}`), [
            trace("u1", "h1", `run-${i}`),
        ]);
    }
    assert.equal(loadTraceRun(state, "run-1").status, "evicted");
    assert.equal(loadTraceRun(state, "run-2").status, "present");
    assert.equal(loadTraceRun(state, "run-9").status, "present");
});
