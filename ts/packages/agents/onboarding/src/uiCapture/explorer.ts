// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
    CapturedState,
    CapturedTransition,
    DecisionInput,
    DecisionOracle,
    ExploreBudget,
    ExploreDecision,
    ExploreRunMetrics,
    FrontierItem,
} from "./exploreTypes.js";
import { ExploreGraph } from "./exploreGraph.js";
import { computeFrontier } from "./frontier.js";
import type { HelperClient } from "./helperClient.js";
import type { DynamicControlRule } from "./types.js";

const DEFAULT_BUDGET: Required<ExploreBudget> = {
    maxIterations: 200,
    maxWallClockMs: 30 * 60_000,
    maxStates: 50,
    convergenceThreshold: 15,
    historyTailSize: 5,
};

export type ExploreOptions = {
    client: HelperClient;
    oracle: DecisionOracle;
    workspaceDir: string;
    rootSelector: string;
    runId?: string;
    dynamicRules?: DynamicControlRule[];
    captureScreenshots?: boolean;
    treeMaxDepth?: number;
    idleDebounceMs?: number;
    idleMaxWaitMs?: number;
    budget?: ExploreBudget;
    onIteration?: (info: {
        iteration: number;
        state: CapturedState;
        decision: ExploreDecision;
    }) => void;
};

/**
 * Deterministic outer loop: capture state → ask oracle → execute → capture
 * post-state → record transition → persist. The oracle decides; we just
 * orchestrate.
 *
 * Snapshot/restore integration is intentionally NOT here yet — slice 6
 * focuses on the loop+graph mechanics. Wiring snapshot capture/restore
 * around runs lands in a follow-up.
 */
export async function runExploration(
    opts: ExploreOptions,
): Promise<ExploreRunMetrics> {
    const budget = { ...DEFAULT_BUDGET, ...(opts.budget ?? {}) };
    const runId =
        opts.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
    const runDir = path.join(opts.workspaceDir, "runs", runId);
    mkdirSync(runDir, { recursive: true });

    const graph = new ExploreGraph(runDir);

    const startedAt = new Date();
    const startTime = Date.now();
    const idleDebounceMs = opts.idleDebounceMs ?? 500;
    const idleMaxWaitMs = opts.idleMaxWaitMs ?? 4000;

    let iteration = 0;
    let stopReason = "loop-completed";
    let lastNewStateIteration = 0;

    try {
        // Pre-loop: capture initial state.
        await opts.client.eventsIdle({
            debounceMs: idleDebounceMs,
            maxWaitMs: idleMaxWaitMs,
        });
        let { state, frontier } = await captureState(
            opts,
            graph,
            opts.rootSelector,
        );
        if (graph.stateCount === 1) {
            lastNewStateIteration = 0;
        }

        while (true) {
            const elapsed = Date.now() - startTime;
            const remainingIterations = budget.maxIterations - iteration;
            const remainingMs = budget.maxWallClockMs - elapsed;

            if (iteration >= budget.maxIterations) {
                stopReason = "max-iterations";
                break;
            }
            if (elapsed >= budget.maxWallClockMs) {
                stopReason = "max-walltime";
                break;
            }
            if (graph.stateCount >= budget.maxStates) {
                stopReason = "max-states";
                break;
            }
            if (
                iteration - lastNewStateIteration >=
                budget.convergenceThreshold
            ) {
                stopReason = "converged";
                break;
            }

            iteration++;
            const input: DecisionInput = {
                iteration,
                state,
                frontier,
                visitedStates: graph.listStateSummaries(),
                recentTransitions: graph.recentTransitions(
                    budget.historyTailSize,
                ),
                budget: { remainingIterations, remainingMs },
            };

            const decision = await opts.oracle.decide(input);
            opts.onIteration?.({ iteration, state, decision });

            if (decision.kind === "stop") {
                stopReason = `oracle-stop: ${decision.reason}`;
                break;
            }
            if (decision.kind === "userPause") {
                // For slice 6a: no implementation; treat as a soft idle.
                await sleep(2000);
                ({ state, frontier } = await captureState(
                    opts,
                    graph,
                    opts.rootSelector,
                ));
                continue;
            }
            if (decision.kind === "restore") {
                // Slice 6a stub: just re-capture (no snapshot integration yet).
                ({ state, frontier } = await captureState(
                    opts,
                    graph,
                    opts.rootSelector,
                ));
                continue;
            }

            // decision.kind === "act"
            const item = frontier.find((f) => f.id === decision.frontierId);
            if (!item) {
                // Oracle picked a stale frontier id; record + skip.
                graph.addTransition({
                    iteration,
                    fromStateId: state.id,
                    toStateId: state.id,
                    trigger: { selector: "(invalid)", verb: decision.verb },
                    rationale: decision.rationale,
                    expectedDelta: decision.expectedDelta,
                    source: "agent",
                    timestamp: Date.now(),
                    success: false,
                    errorMessage: `unknown frontier id ${decision.frontierId}`,
                });
                continue;
            }

            const transition = await executeAction(opts, graph, {
                iteration,
                fromState: state,
                item,
                decision,
                rootSelector: opts.rootSelector,
                idleDebounceMs,
                idleMaxWaitMs,
            });

            // Re-capture for next iteration.
            const next = await captureState(
                opts,
                graph,
                opts.rootSelector,
            );
            if (graph.findStateByFingerprint(next.state.fingerprint)?.id ===
                next.state.id &&
                next.state.id !== state.id) {
                lastNewStateIteration = iteration;
            }
            state = next.state;
            frontier = next.frontier;
            // ensure graph has transition's toState resolved for callers reading it
            void transition;
        }
    } finally {
        await graph.close();
    }

    const endedAt = new Date();
    const metrics: ExploreRunMetrics = {
        runId,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        walltimeMs: endedAt.getTime() - startedAt.getTime(),
        iterations: iteration,
        statesDiscovered: graph.stateCount,
        transitionsRecorded: graph.transitionCount,
        successfulTransitions: graph.successfulTransitionCount,
        failedTransitions: graph.failedTransitionCount,
        stopReason,
        convergenceIterations: lastNewStateIteration,
    };
    writeFileSync(
        path.join(runDir, "metrics.json"),
        JSON.stringify(metrics, null, 2),
    );
    return metrics;
}

async function captureState(
    opts: ExploreOptions,
    graph: ExploreGraph,
    rootSelector: string,
): Promise<{ state: CapturedState; frontier: FrontierItem[] }> {
    const fp = await opts.client.treeFingerprint({
        root: rootSelector,
        ...(opts.dynamicRules !== undefined
            ? { dynamicRules: opts.dynamicRules }
            : {}),
    });
    const tree = await opts.client.treeDump({
        root: rootSelector,
        maxDepth: opts.treeMaxDepth ?? 12,
    });
    let screenshotPngBase64: string | undefined;
    if (opts.captureScreenshots) {
        try {
            const shot = await opts.client.screenshot({ root: rootSelector });
            screenshotPngBase64 = shot.pngBase64;
        } catch {
            /* screenshots are best-effort */
        }
    }
    const { state } = graph.upsertState({
        fingerprint: fp.hash,
        windowTitle: fp.activeWindowTitle,
        tree,
        ...(screenshotPngBase64 !== undefined ? { screenshotPngBase64 } : {}),
    });
    const frontier = computeFrontier(tree);
    return { state, frontier };
}

async function executeAction(
    opts: ExploreOptions,
    graph: ExploreGraph,
    args: {
        iteration: number;
        fromState: CapturedState;
        item: FrontierItem;
        decision: { verb: string; value?: string | number | boolean; expectedDelta: string; rationale: string };
        rootSelector: string;
        idleDebounceMs: number;
        idleMaxWaitMs: number;
    },
): Promise<CapturedTransition> {
    const { client } = opts;
    const { item, decision } = args;
    const verb = decision.verb;

    let success = true;
    let errorMessage: string | undefined;
    try {
        switch (verb) {
            case "invoke":
                await client.doInvoke({ selector: item.selector });
                break;
            case "toggle":
                await client.doToggle({
                    selector: item.selector,
                    ...(typeof decision.value === "boolean"
                        ? { value: decision.value }
                        : {}),
                });
                break;
            case "select":
                await client.doSelect({
                    selector: item.selector,
                    ...(decision.value !== undefined
                        ? { item: decision.value as string | number }
                        : {}),
                });
                break;
            case "expand":
                await client.doExpand({
                    selector: item.selector,
                    expand: decision.value !== false,
                });
                break;
            case "setValue":
                await client.doSetValue({
                    selector: item.selector,
                    value: decision.value ?? "",
                });
                break;
            case "scroll":
                await client.doScroll({
                    selector: item.selector,
                    direction: "down",
                });
                break;
            case "focus":
                await client.doFocus({ selector: item.selector });
                break;
            case "click":
                await client.doClick({ selector: item.selector });
                break;
            default:
                success = false;
                errorMessage = `unsupported verb ${verb}`;
        }
    } catch (e) {
        success = false;
        errorMessage = e instanceof Error ? e.message : String(e);
    }

    await client.eventsIdle({
        debounceMs: args.idleDebounceMs,
        maxWaitMs: args.idleMaxWaitMs,
    });

    // Capture post-state to link transition.
    const fp = await client.treeFingerprint({
        root: args.rootSelector,
        ...(opts.dynamicRules !== undefined
            ? { dynamicRules: opts.dynamicRules }
            : {}),
    });
    const tree = await client.treeDump({
        root: args.rootSelector,
        maxDepth: opts.treeMaxDepth ?? 12,
    });
    const { state: toState } = graph.upsertState({
        fingerprint: fp.hash,
        windowTitle: fp.activeWindowTitle,
        tree,
    });

    return graph.addTransition({
        iteration: args.iteration,
        fromStateId: args.fromState.id,
        toStateId: toState.id,
        trigger: {
            selector: item.selector,
            verb: verb as any,
            ...(decision.value !== undefined ? { value: decision.value } : {}),
        },
        rationale: decision.rationale,
        expectedDelta: decision.expectedDelta,
        observedDeltaSummary: args.fromState.id === toState.id
            ? "no observable state change"
            : `${args.fromState.id} → ${toState.id}`,
        source: "agent",
        timestamp: Date.now(),
        success,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
    });
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, ms));
}
