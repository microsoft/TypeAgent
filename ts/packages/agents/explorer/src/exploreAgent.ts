// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    processReasoningSession,
    type ReasoningDisplaySink,
    type ReasoningLoopConfig,
} from "agent-dispatcher/reasoning";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import {
    DISCOVER_REPOSITORY_ACTION,
    ExplorerActionSession,
    MAX_REFINEMENT_READ_LINES,
    REFINE_REPOSITORY_ACTION,
    REFINEMENT_RESERVED_CALLS,
    SUBMIT_EXPLORATION_ACTION,
    getRepositorySandboxSchema,
} from "./actionHandler.js";
import { createExplorerActionDispatcher } from "./reasoning/explorerActionDispatcher.js";
import {
    createExplorerReasoningTools,
    createExplorerReasoningState,
    type ExplorerReasoningState,
} from "./reasoning/explorerReasoningTools.js";
import type { RepositoryToolTrace } from "./script/repositoryApi.js";
import {
    addExploreUsage,
    createUsage,
    writeExploreTelemetry,
} from "./telemetry.js";
import type {
    CodeModeExplorerOptions,
    ExploreInvocationTelemetry,
    ExploreTelemetry,
    RepositoryExploreResult,
    RepositoryExplorer,
} from "./types.js";

export type {
    CodeModeExplorerOptions,
    ExploreInvocationTelemetry,
    ExploreTelemetry,
    ExploreUsage,
    ExplorerReasoningSDKAdapter,
} from "./types.js";

const DEFAULT_MAX_RESULTS = 6;
const MAX_RESULTS = 6;
const DEFAULT_MAX_TOOL_CALLS = 8;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_CHARS = 8_000;
const MAX_REASONING_TOOL_CALLS = 5;

export function createCodeModeExplorer(
    options: CodeModeExplorerOptions,
): RepositoryExplorer {
    const repoRoot = realpath(path.resolve(options.repoRoot));
    const executionTimeoutMs = positiveInteger(
        options.executionTimeoutMs,
        DEFAULT_EXECUTION_TIMEOUT_MS,
        "executionTimeoutMs",
    );
    const maxToolCalls = positiveInteger(
        options.maxToolCalls,
        DEFAULT_MAX_TOOL_CALLS,
        "maxToolCalls",
    );
    const maxOutputChars = positiveInteger(
        options.maxOutputChars,
        DEFAULT_MAX_OUTPUT_CHARS,
        "maxOutputChars",
    );
    const telemetryFile = options.telemetryFile
        ? path.resolve(options.telemetryFile)
        : undefined;
    const invocationLedger: Array<ExploreInvocationTelemetry | undefined> = [];
    let telemetryWriteQueue = Promise.resolve();

    return {
        explore: async (request) => (await exploreDetailed(request)).text,
        exploreDetailed,
        close: async () => options.reasoningAdapter.close?.(),
    };

    async function exploreDetailed(
        request: Parameters<RepositoryExplorer["explore"]>[0],
    ): Promise<RepositoryExploreResult> {
        const query = request.query;
        if (!query.trim()) {
            throw new Error("query must not be empty");
        }
        const invocationStartedMs = Date.now();
        const invocationStartedAt = new Date(invocationStartedMs).toISOString();
        const querySha256 = createHash("sha256")
            .update(query, "utf8")
            .digest("hex");
        const maxResults = Math.min(
            MAX_RESULTS,
            positiveInteger(
                request.maxResults,
                DEFAULT_MAX_RESULTS,
                "maxResults",
            ),
        );
        const invocationIndex = invocationLedger.length;
        invocationLedger.push(undefined);
        const usage = createUsage();
        let actionSession: ExplorerActionSession | undefined;
        let reasoningTrace: ExploreInvocationTelemetry["reasoningTrace"] = [];
        try {
            const canonicalRepoRoot = await repoRoot;
            actionSession = await ExplorerActionSession.create({
                repoRoot: canonicalRepoRoot,
                query,
                maxResults,
                maxToolCalls,
                maxOutputChars,
                executionTimeoutMs,
                ...(options.lsp ? { lsp: options.lsp } : {}),
            });
            const actionDispatcher =
                await createExplorerActionDispatcher(actionSession);
            try {
                const repositorySchema = getRepositorySandboxSchema(
                    options.lsp !== undefined,
                );
                const reasoningState = createExplorerReasoningState(
                    MAX_REASONING_TOOL_CALLS,
                );
                reasoningTrace = reasoningState.trace;
                await runReasoningLoop(
                    buildExplorerSystemPrompt(
                        maxResults,
                        maxToolCalls,
                        repositorySchema,
                        options.lsp !== undefined,
                    ),
                    buildExplorerUserPrompt(query, maxResults),
                    actionDispatcher,
                    reasoningState,
                    options,
                    usage,
                    {
                        allowedActions: [
                            DISCOVER_REPOSITORY_ACTION,
                            REFINE_REPOSITORY_ACTION,
                        ],
                        terminalActions: [REFINE_REPOSITORY_ACTION],
                        maxTurns: remainingReasoningTurns(reasoningState),
                        maxResults,
                        trajectoryInvocationIndex: invocationIndex,
                    },
                );
                await runReasoningLoop(
                    buildSubmissionSystemPrompt(maxResults),
                    buildSubmissionUserPrompt(
                        query,
                        maxResults,
                        actionSession.submissionContext(),
                    ),
                    actionDispatcher,
                    reasoningState,
                    options,
                    usage,
                    {
                        allowedActions: [SUBMIT_EXPLORATION_ACTION],
                        terminalActions: [SUBMIT_EXPLORATION_ACTION],
                        maxTurns: remainingReasoningTurns(reasoningState),
                        maxResults,
                        trajectoryInvocationIndex: invocationIndex,
                    },
                );
            } catch (error) {
                try {
                    await closeActionDispatcher(actionDispatcher);
                } catch (closeError) {
                    throw new AggregateError(
                        [error, closeError],
                        error instanceof Error ? error.message : String(error),
                    );
                }
                throw error;
            }

            await closeActionDispatcher(actionDispatcher);

            const snapshot = actionSession.snapshot();
            if (!snapshot.submitted || !snapshot.text || !snapshot.result) {
                throw new Error(
                    "Explorer reasoning loop did not submit a grounded exploration",
                );
            }
            await actionSession.close();
            actionSession = undefined;
            const invocation = createInvocation(
                invocationIndex,
                "completed",
                invocationStartedAt,
                invocationStartedMs,
                querySha256,
                usage,
                snapshot.toolTrace,
                reasoningTrace,
                snapshot.actionAttempts,
                snapshot.result,
            );
            await recordTelemetry(invocation);
            return {
                text: snapshot.text,
                usage: { ...usage },
                toolTrace: snapshot.toolTrace,
                result: snapshot.result,
            };
        } catch (error) {
            let failure: unknown = error;
            if (actionSession) {
                try {
                    await actionSession.close();
                } catch (closeError) {
                    failure = new AggregateError([error, closeError]);
                }
            }
            const message =
                failure instanceof Error ? failure.message : String(failure);
            const snapshot = actionSession?.snapshot();
            try {
                await recordTelemetry(
                    createInvocation(
                        invocationIndex,
                        "failed",
                        invocationStartedAt,
                        invocationStartedMs,
                        querySha256,
                        usage,
                        snapshot?.toolTrace ?? emptyToolTrace(),
                        reasoningTrace,
                        snapshot?.actionAttempts ?? [],
                        snapshot?.result,
                        message,
                    ),
                );
            } catch {
                // Preserve the exploration failure rather than telemetry I/O.
            }
            throw failure;
        }
    }

    function recordTelemetry(
        invocation: ExploreInvocationTelemetry,
    ): Promise<void> {
        invocationLedger[invocation.index] = invocation;
        const firstPending = invocationLedger.indexOf(undefined);
        const completedPrefix = invocationLedger.slice(
            0,
            firstPending === -1 ? invocationLedger.length : firstPending,
        ) as ExploreInvocationTelemetry[];
        if (completedPrefix.length === 0) {
            return Promise.resolve();
        }
        const telemetry: ExploreTelemetry = {
            schemaVersion: 4,
            model: options.modelName,
            invocations: completedPrefix,
        };
        const write = telemetryWriteQueue.then(() =>
            writeExploreTelemetry(telemetryFile, telemetry),
        );
        telemetryWriteQueue = write.catch(() => undefined);
        return write;
    }
}

async function runReasoningLoop(
    systemPrompt: string,
    userPrompt: string,
    dispatcher: Awaited<ReturnType<typeof createExplorerActionDispatcher>>,
    reasoningState: ExplorerReasoningState,
    options: CodeModeExplorerOptions,
    usage: ExploreInvocationTelemetry["usage"],
    phase: {
        allowedActions: readonly (
            | typeof DISCOVER_REPOSITORY_ACTION
            | typeof REFINE_REPOSITORY_ACTION
            | typeof SUBMIT_EXPLORATION_ACTION
        )[];
        terminalActions: readonly (
            | typeof DISCOVER_REPOSITORY_ACTION
            | typeof REFINE_REPOSITORY_ACTION
            | typeof SUBMIT_EXPLORATION_ACTION
        )[];
        maxTurns: number;
        maxResults: number;
        trajectoryInvocationIndex: number;
    },
): Promise<string> {
    const reasoningTools = createExplorerReasoningTools(
        dispatcher,
        reasoningState,
        phase,
    );
    const config: ReasoningLoopConfig = {
        model: options.modelName,
        systemPrompt,
        maxTurns: phase.maxTurns,
        tools: reasoningTools.tools,
        trajectoryInvocationIndex: phase.trajectoryInvocationIndex,
    };
    const reasoningSession =
        await options.reasoningAdapter.createSession(config);
    try {
        const result = await processReasoningSession(
            reasoningSession,
            userPrompt,
            config,
            nullDisplay,
        );
        if (result.result === undefined) {
            throw new Error(
                "Explorer reasoning phase returned no action result",
            );
        }
        return result.result;
    } finally {
        addExploreUsage(usage, reasoningSession.getUsage());
    }
}

function remainingReasoningTurns(state: ExplorerReasoningState): number {
    const remaining = state.maxToolCalls - state.toolCalls;
    if (remaining <= 0) {
        throw new Error(
            `Explorer reasoning exhausted its ${state.maxToolCalls}-action budget`,
        );
    }
    return remaining;
}

async function closeActionDispatcher(
    dispatcher: Awaited<ReturnType<typeof createExplorerActionDispatcher>>,
): Promise<void> {
    try {
        await dispatcher.close();
    } catch (firstError) {
        try {
            await dispatcher.close();
        } catch (secondError) {
            throw new AggregateError(
                [firstError, secondError],
                firstError instanceof Error
                    ? firstError.message
                    : String(firstError),
            );
        }
    }
}

function buildExplorerSystemPrompt(
    maxResults: number,
    maxToolCalls: number,
    repositorySchema: string,
    enableLsp: boolean,
): string {
    const discoveryCalls = Math.max(
        1,
        maxToolCalls - REFINEMENT_RESERVED_CALLS,
    );
    return `You are the TypeAgent repository Explorer. Complete discovery and refinement in one bounded investigation session. A fresh evidence-only session will perform final selection after this session ends:

1. Call execute_action with explorer.discoverRepository and one complete read-only Code Mode program using at most ${discoveryCalls} repository calls; ${REFINEMENT_RESERVED_CALLS} of the shared ${maxToolCalls}-call evidence budget are reserved for adaptive refinement.
2. Inspect the returned repository evidence, then call execute_action with explorer.refineRepository exactly once. Use the remaining repository calls reported by discovery to verify missing production context and independently indicated companion sites.

Correct a failed action only when its error explicitly permits repair. The action handler enforces discovery and refinement order. A successful refineRepository action ends this investigation session.

Repository rules:
- Static inspection only. Use repo.ls, repo.glob, repo.grep, and repo.read${enableLsp ? ", plus optional repo.lsp navigation" : ""}.
- Begin exactly with async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> { and return { success: true }. Never send only the function body.
- Make the first grep use the rarest exact clue in the request: a qualified symbol, quoted error, configuration key, or named file. Search bare identifiers until the repository language is confirmed.
- Group matches by file, then read contextual blocks from 3-5 distinct likely source files. Use results to choose paths and offsets; do not hard-code guessed files.
- Prioritize production implementation files. Inspect tests, configuration, or documentation when the request or an observed dependency indicates that they change, never instead of the implementation.
- Read likely definitions through the end of their bodies. When relevant matches are far apart, reserve separate reads so a later function is not pushed outside the observed range.
- After a broad symbol search identifies a long candidate, scope remaining grep calls to that file with an issue-specific expression and anchor reads on those body matches.
- Trace evidence-indicated callers, helpers, and alternate implementations. Treat historical paths and line numbers only as clues.
- Do not repeat broad searches during refinement. Prefer targeted repo.read calls of 80-${MAX_REFINEMENT_READ_LINES} lines, and use repo.grep only when discovery supplies a precise path and issue-specific expression.
- Type empty accumulators explicitly, for example const matches: GrepMatch[] = [].
- Discovery and refinement may return up to ${maxResults} focused advisory candidate locations supported by inspected evidence. Candidates guide final selection but never ground it.
${enableLsp ? buildLspRules() : ""}

Authoritative Code Mode repository schema:
${repositorySchema}`;
}

function buildSubmissionSystemPrompt(maxResults: number): string {
    return `You are the TypeAgent repository Explorer final selector. Use only the original request and authoritative evidence in the user message, then call execute_action with explorer.submitExploration. No repository tools are available in this phase. If submission is rejected, correct only the reported grounding problem.

Submission rules:
- Submit at most ${maxResults} repository-relative locations most likely needing changes.
- Submit the complete high-confidence set of independently evidenced change-bearing locations, not merely the single strongest site. When evidence remains ambiguous between plausible change sites, include each independently grounded plausible site within the location limit.
- A definition, caller, test, or alternate implementation that only helps understanding is not itself change-bearing; omit it unless the request or observed dependency indicates that it must change.
- Every submitted line from startLine through endLine must be wholly visible in contiguous successful grep or read evidence in the authoritative evidence. A grep line grounds only that exact line; never extend beyond a visible read interval or bridge a gap between visible lines. LSP results and advisory candidates are navigation clues only.
- When contiguous read evidence exposes it, prefer complete behavior-bearing blocks over isolated interior statements without automatically submitting an entire read window. Usually select the complete relevant 5-200 line function, method, definition, or enclosing branch; do not clip a relevant block merely to keep it short.
- Cover distinct production files when the request is cross-cutting. Include tests, configuration, or documentation only when the request or observed dependency makes them change-bearing.
- Do not emit duplicate or overlapping locations and do not invent repository content.`;
}

function buildLspRules(): string {
    return `
- For this LSP treatment, after grep identifies a supported Python or TypeScript symbol, make exactly one repo.lsp definition call during discovery using its path, 1-based line clue, and exact identifier. A non-discarded attempt satisfies adoption even when it returns no locations and retains an error for telemetry; do not repair or repeat it for that reason alone.
- Do not repeat repo.lsp during refinement when discovery already attempted it. If discovery omitted it, the discovery result directs refinement to make exactly one attempt before reading. LSP results are navigation only; use repo.read to ground any returned location before final selection.
- repo.lsp has a separate two-call safety allowance and does not consume the repository evidence-call budget.`;
}

function buildExplorerUserPrompt(query: string, maxResults: number): string {
    return `Explore this repository request and gather evidence for at most ${maxResults} final file/line localizations:\n\n<query>\n${query}\n</query>`;
}

function buildSubmissionUserPrompt(
    query: string,
    maxResults: number,
    evidence: string,
): string {
    return `Select and submit at most ${maxResults} grounded file/line localizations for this request:\n\n<query>\n${query}\n</query>\n\n<authoritative_evidence>\n${evidence}\n</authoritative_evidence>`;
}

function createInvocation(
    index: number,
    status: "completed" | "failed",
    startedAt: string,
    startedMs: number,
    querySha256: string,
    usage: ExploreInvocationTelemetry["usage"],
    toolTrace: RepositoryToolTrace,
    reasoningTrace: ExploreInvocationTelemetry["reasoningTrace"],
    actionAttempts: ExploreInvocationTelemetry["actionAttempts"],
    result?: ExploreInvocationTelemetry["result"],
    error?: string,
): ExploreInvocationTelemetry {
    return {
        index,
        status,
        startedAt,
        durationMs: Math.max(0, Date.now() - startedMs),
        querySha256,
        usage: { ...usage },
        actionTranslationAndCodeGenerationUsage: { ...usage },
        toolTrace,
        reasoningTrace: reasoningTrace.map((attempt) => ({ ...attempt })),
        actionAttempts: actionAttempts.map((attempt) => ({ ...attempt })),
        ...(result ? { result } : {}),
        ...(error ? { error: error.slice(0, 2_000) } : {}),
    };
}

function emptyToolTrace(): RepositoryToolTrace {
    return { calls: [], totalCalls: 0, totalOutputBytes: 0 };
}

function positiveInteger(
    value: number | undefined,
    fallback: number,
    name: string,
): number {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
    return result;
}

const nullDisplay: ReasoningDisplaySink = {
    appendMarkdown: () => undefined,
    appendHtml: () => undefined,
    appendInfo: () => undefined,
    appendTemporary: () => undefined,
    appendStep: () => undefined,
};
