// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    processReasoningSession,
    type ReasoningDisplaySink,
    type ReasoningLoopConfig,
} from "agent-dispatcher/reasoning";
import { realpath } from "node:fs/promises";
import path from "node:path";
import {
    ExplorerActionSession,
    MAX_REFINEMENT_CALLS_PER_PROGRAM,
    MAX_REFINEMENT_READ_LINES,
    REFINEMENT_RESERVED_CALLS,
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
        const query = request.query.trim();
        if (!query) {
            throw new Error("query must not be empty");
        }
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
                const actionSchema =
                    await actionDispatcher.discoverActions("explorer");
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
                        actionSchema,
                        repositorySchema,
                        options.lsp !== undefined,
                    ),
                    buildExplorerUserPrompt(query, maxResults),
                    actionDispatcher,
                    reasoningState,
                    options,
                    usage,
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
        const telemetry: ExploreTelemetry = {
            schemaVersion: 4,
            model: options.modelName,
            invocations: invocationLedger.filter(
                (value): value is ExploreInvocationTelemetry =>
                    value !== undefined,
            ),
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
): Promise<void> {
    const reasoningTools = createExplorerReasoningTools(
        dispatcher,
        reasoningState,
    );
    const config: ReasoningLoopConfig = {
        model: options.modelName,
        systemPrompt,
        maxTurns: reasoningState.maxToolCalls,
        tools: reasoningTools.tools,
    };
    const reasoningSession =
        await options.reasoningAdapter.createSession(config);
    try {
        await processReasoningSession(
            reasoningSession,
            userPrompt,
            config,
            nullDisplay,
        );
    } finally {
        addExploreUsage(usage, reasoningSession.getUsage());
    }
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
    actionSchema: string,
    repositorySchema: string,
    enableLsp: boolean,
): string {
    return `You are the TypeAgent repository Explorer. Complete this typed action sequence in one bounded reasoning session. Every action is validated and executed through the TypeAgent dispatcher:

1. Call execute_action with explorer.discoverRepository. Generate one complete read-only Code Mode program using at most ${Math.max(1, maxToolCalls - REFINEMENT_RESERVED_CALLS)} repository calls because ${REFINEMENT_RESERVED_CALLS} calls are reserved for refinement. Use the final discovery call to read the strongest production candidate when grep results alone do not expose its helper bodies.
2. Inspect the returned repository-grounded evidence, then call execute_action with explorer.refineRepository exactly once. Generate one complete read-only Code Mode program using at most ${MAX_REFINEMENT_CALLS_PER_PROGRAM} repository calls. Verify primary mutation sites with repo.read calls of at most ${MAX_REFINEMENT_READ_LINES} lines. You may use repo.ls or repo.glob to locate companion files and at most two targeted repo.grep calls to follow helpers, long functions, or alternate production files exposed by discovery. Trace cross-file caller/callee paths and behavior-bearing helper definitions before tests. Read exact companion context and alternate production candidates when evidence conflicts.
3. Inspect the returned refinement result, then call explorer.submitExploration with no more than ${maxResults} exact repository-relative locations most likely needing changes. Every submitted range must be wholly visible in successful grep or read evidence. The successful submission ends the loop; do not call refineRepository a second time.

${buildProgramRules(maxResults, maxToolCalls, enableLsp)}${enableLsp ? buildLspRules() : ""}

Authoritative TypeAgent action schema:
${actionSchema}

Authoritative Code Mode repository schema:
${repositorySchema}`;
}

function buildLspRules(): string {
    return `
- This LSP treatment must call repo.lsp at least once. Use a grep result to supply its path, 1-based line hint, and source identifier as symbol. The line hint may be within three lines of a multiline call. Prefer definition; use references only after narrowing to a strong candidate.
- The server registry selects an available pre-provisioned language server from the file extension and nearest project root. Do not call repo.lsp when the repository has no configured server for that file type.
- LSP locations are navigation clues, not submission evidence. Read the relevant returned locations with repo.read before submitting them.
- At most two LSP calls are available across discovery and refinement.`;
}

function buildProgramRules(
    maxResults: number,
    maxToolCalls: number,
    enableLsp = false,
): string {
    return `Repository rules:
- Static inspection only. Use only repo.ls, repo.glob, repo.grep, and repo.read${enableLsp ? ", and repo.lsp" : ""} inside the generated program.
- Every program must be a complete string beginning exactly with async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> { and ending with }. Never send only the function body.
- Discovery and all refinements share one budget of at most ${maxToolCalls} repository calls.
- The first grep must use the rarest exact clue present in the request: a qualified symbol such as Class.method, quoted error, configuration key, or named file. Do not start with generic concept words when an exact clue is available. Only broaden after the exact clue is absent or insufficient. grep uses safe regular expressions by default; literal is only for fixed strings.
- Search bare identifiers unless the repository language is already confirmed; do not add a language-specific declaration keyword such as function or def to every symbol search.
- After a broad symbol search identifies a long candidate function, scope remaining grep calls to that file with path and search for issue-specific expressions. Anchor reads on those body matches, not the function definition or header unless the header itself is likely to change.
- When the reported behavior is inside a long function and the first read does not expose the relevant branch, use consecutive non-overlapping read windows in that production function before tests.
- Trace cross-file caller/callee paths and inspect behavior-bearing helpers and alternate production implementations before tests. Do not stop at the first plausible file when the request or discovery evidence identifies companion behavior.
- When discovery exposes a production caller and a separate behavior-bearing helper, begin refinement with repo.read calls for both caller and helper before spending calls on repo.glob or test searches.
- When a request names more independent change sites than the maximum of ${maxResults} locations, consolidate nearby related production definitions into the smallest grounded enclosing range that covers them instead of dropping named sites. Never merge unrelated files or submit an entire file.
- Type empty accumulators explicitly, for example const matches: GrepMatch[] = []; never rely on inference from an untyped [].
- Prioritize production implementation files before tests, docs, examples, assets, and generated files.
- Treat historical paths and line numbers as clues and verify them against current repository contents.
- Repository call results are captured automatically. Each generated program should return { success: true } after it finishes inspecting; do not copy candidate locations into the program result.
- Submit no more than ${maxResults} final locations for the exact lines or line ranges most likely needing changes. Prefer complete behavior-bearing blocks over isolated interior statements; do not automatically submit an entire read window or fabricate repository contents or ranges.`;
}

function buildExplorerUserPrompt(query: string, maxResults: number): string {
    return `Explore this repository request and submit at most ${maxResults} grounded file/line localizations:\n\n${query}`;
}

function createInvocation(
    index: number,
    status: "completed" | "failed",
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
