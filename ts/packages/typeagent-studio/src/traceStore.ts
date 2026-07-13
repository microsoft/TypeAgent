// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as vscode from "vscode";
import type {
    ReplayResolutionTrace,
    ReplayRunDescriptor,
    ReplaySideTrace,
    ReplayTraceNode,
    SerializedGrammarDebugInfo,
} from "@typeagent/core/replay";

// Per-red-row resolution traces + the run descriptor are persisted here so the
// Trace Viewer can open the exact side-by-side resolution that produced a row
// long after the run streamed, and can recompute a fresh trace from the same
// pinned inputs. Retention mirrors the Impact Report: one run is kept per agent
// (a new run for the agent evicts the previous one), and a small global cap
// bounds how many agents' runs are retained at once.

/** Keep the last run for at most this many agents so the persisted payload stays
 *  bounded even if the user cycles through many agents. */
const MAX_RETAINED_RUNS = 8;

const runKey = (runId: string): string => `traceRun.${runId}`;
const agentRunKey = (agent: string): string => `traceRun.byAgent.${agent}`;
const RUN_ORDER_KEY = "traceRun.order";
const EVICTED_KEY = "traceRun.evicted";

/** Remember this many recently evicted run ids so the viewer can distinguish a
 *  run whose traces were rotated out ("evicted") from a run id it never stored
 *  ("missing"). */
const MAX_EVICTED_TOMBSTONES = 32;

/** A grammar-match node with its heavy debug info lifted into the run-level
 *  dedupe table, referenced by the grammar hash it was stored under. */
type StoredNode = ReplayTraceNode & { debugInfoRef?: string };

/** The persisted form of a run's traces: the descriptor, every row's trace with
 *  grammar debug info stripped to a per-run reference, and the deduped debug-info
 *  blobs keyed by grammar hash (one copy per distinct grammar, not per row). */
interface StoredTraceRun {
    descriptor: ReplayRunDescriptor;
    agent: string;
    capturedAt: number;
    debugInfos: Record<string, SerializedGrammarDebugInfo>;
    rows: Record<string, ReplayResolutionTrace>;
}

/** The outcome of looking up a run's traces. `present` carries the rehydrated
 *  traces; `evicted` means the run existed but its traces were rotated out (the
 *  report may outlive them); `missing` means the run was never stored. */
export type TraceRunLookup =
    | {
          status: "present";
          descriptor: ReplayRunDescriptor;
          traces: ReplayResolutionTrace[];
      }
    | { status: "evicted" }
    | { status: "missing" };

/** JSON round-trips through the Memento anyway; clone up front so stripping the
 *  debug info never mutates the caller's traces. */
function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function grammarNodes(side: ReplaySideTrace): StoredNode[] {
    return side.nodes as StoredNode[];
}

/** Move each grammar-match node's debug info into `debugInfos` (keyed by its
 *  grammar hash) and replace it on the node with a lightweight reference, so a
 *  grammar shared across rows is stored once per run rather than per row. */
function stripDebugInfo(
    trace: ReplayResolutionTrace,
    debugInfos: Record<string, SerializedGrammarDebugInfo>,
): ReplayResolutionTrace {
    const copy = clone(trace);
    for (const side of [copy.a, copy.b]) {
        for (const node of grammarNodes(side)) {
            if (node.kind !== "grammar-match" || node.debugInfo === undefined) {
                continue;
            }
            const hash = node.debugInfo.grammarHash;
            if (debugInfos[hash] === undefined) {
                debugInfos[hash] = node.debugInfo;
            }
            node.debugInfoRef = hash;
            node.debugInfo = undefined;
        }
    }
    return copy;
}

/** Reverse {@link stripDebugInfo}: put each grammar-match node's debug info back
 *  from the run-level table so the returned trace is fully self-contained. */
function rehydrateDebugInfo(
    trace: ReplayResolutionTrace,
    debugInfos: Record<string, SerializedGrammarDebugInfo>,
): ReplayResolutionTrace {
    const copy = clone(trace);
    for (const side of [copy.a, copy.b]) {
        for (const node of grammarNodes(side)) {
            if (
                node.kind !== "grammar-match" ||
                node.debugInfoRef === undefined
            ) {
                continue;
            }
            const info = debugInfos[node.debugInfoRef];
            if (info !== undefined) {
                node.debugInfo = info;
            }
            node.debugInfoRef = undefined;
        }
    }
    return copy;
}

/** Persist a run's descriptor and its captured red-row traces. Evicts the
 *  agent's previous run and enforces the global retention cap so the workspace
 *  state stays bounded. Awaits the underlying writes so the data is durable
 *  before the caller proceeds. */
export async function saveTraceRun(
    state: vscode.Memento,
    descriptor: ReplayRunDescriptor,
    traces: readonly ReplayResolutionTrace[],
): Promise<void> {
    const debugInfos: Record<string, SerializedGrammarDebugInfo> = {};
    const rows: Record<string, ReplayResolutionTrace> = {};
    for (const trace of traces) {
        rows[trace.utteranceId] = stripDebugInfo(trace, debugInfos);
    }
    const stored: StoredTraceRun = {
        descriptor,
        agent: descriptor.agent,
        capturedAt: Date.now(),
        debugInfos,
        rows,
    };

    // Evict this agent's previous run before recording the new one.
    const previousForAgent = state.get<string>(agentRunKey(descriptor.agent));
    if (
        previousForAgent !== undefined &&
        previousForAgent !== descriptor.runId
    ) {
        await evictRun(state, previousForAgent);
    }

    await state.update(runKey(descriptor.runId), stored);
    await state.update(agentRunKey(descriptor.agent), descriptor.runId);

    const order = (state.get<string[]>(RUN_ORDER_KEY) ?? []).filter(
        (id) => id !== descriptor.runId,
    );
    order.push(descriptor.runId);
    await state.update(RUN_ORDER_KEY, order);

    // evictRun rewrites the order list in state, so re-read it each pass rather
    // than trusting the stale local copy.
    let retained = order;
    while (retained.length > MAX_RETAINED_RUNS) {
        await evictRun(state, retained[0]);
        retained = state.get<string[]>(RUN_ORDER_KEY) ?? [];
    }
}

/** Remove a run's stored blob, drop it from the retained order, clear its agent
 *  pointer, and record a bounded tombstone so a later lookup reports `evicted`
 *  rather than `missing`. */
async function evictRun(state: vscode.Memento, runId: string): Promise<void> {
    const stored = state.get<StoredTraceRun>(runKey(runId));
    await state.update(runKey(runId), undefined);
    if (stored !== undefined) {
        const pointer = state.get<string>(agentRunKey(stored.agent));
        if (pointer === runId) {
            await state.update(agentRunKey(stored.agent), undefined);
        }
    }

    const order = (state.get<string[]>(RUN_ORDER_KEY) ?? []).filter(
        (id) => id !== runId,
    );
    await state.update(RUN_ORDER_KEY, order);

    const evicted = (state.get<string[]>(EVICTED_KEY) ?? []).filter(
        (id) => id !== runId,
    );
    evicted.push(runId);
    while (evicted.length > MAX_EVICTED_TOMBSTONES) {
        evicted.shift();
    }
    await state.update(EVICTED_KEY, evicted);
}

/** Look up a run's captured traces, rehydrated with their grammar debug info.
 *  Returns `evicted` when the run was recorded but has since been rotated out,
 *  and `missing` when it was never stored. */
export function loadTraceRun(
    state: vscode.Memento,
    runId: string,
): TraceRunLookup {
    const stored = state.get<StoredTraceRun>(runKey(runId));
    if (stored === undefined) {
        const evicted = state.get<string[]>(EVICTED_KEY) ?? [];
        return evicted.includes(runId)
            ? { status: "evicted" }
            : { status: "missing" };
    }
    const traces = Object.values(stored.rows).map((row) =>
        rehydrateDebugInfo(row, stored.debugInfos),
    );
    return { status: "present", descriptor: stored.descriptor, traces };
}

/** Look up a single row's trace by run and utterance, rehydrated with its
 *  grammar debug info. `undefined` when the run or row is not present. */
export function loadResolutionTrace(
    state: vscode.Memento,
    runId: string,
    utteranceId: string,
):
    | { descriptor: ReplayRunDescriptor; trace: ReplayResolutionTrace }
    | undefined {
    const stored = state.get<StoredTraceRun>(runKey(runId));
    const row = stored?.rows[utteranceId];
    if (stored === undefined || row === undefined) {
        return undefined;
    }
    return {
        descriptor: stored.descriptor,
        trace: rehydrateDebugInfo(row, stored.debugInfos),
    };
}
