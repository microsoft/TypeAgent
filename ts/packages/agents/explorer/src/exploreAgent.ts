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
                ...(options.ripgrepPath
                    ? { ripgrepPath: options.ripgrepPath }
                    : {}),
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
                snapshot.submissionAction,
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
                        snapshot?.submissionAction,
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

1. Call execute_action with explorer.discoverRepository. Generate one complete read-only Code Mode program returning Promise<DiscoveryProgramResult> and using at most ${Math.max(1, maxToolCalls - REFINEMENT_RESERVED_CALLS)} repository calls because ${REFINEMENT_RESERVED_CALLS} calls are reserved for refinement. Return locations: [] from discovery. Use the final discovery call to read the strongest candidate when grep results alone do not expose the relevant context.
2. Inspect the returned repository-grounded evidence, then call execute_action with explorer.refineRepository. Generate one complete read-only Code Mode program returning Promise<RefinementProgramResult> and using at most ${MAX_REFINEMENT_CALLS_PER_PROGRAM} repository calls. Verify candidate sites with repo.read calls of at most ${MAX_REFINEMENT_READ_LINES} lines. You may use repo.ls or repo.glob to locate companion files and at most two targeted repo.grep calls to narrow discovery results. Return no more than ${maxResults} grounded candidate locations in the program's non-empty locations array.
3. Inspect the executed refinement evidence, then call explorer.submitExploration with the final exact repository-relative locations most likely needing changes. Every submitted range must be wholly visible in a successful read observation returned by the two executed programs; grep and LSP only locate candidates and never ground final ranges. Never submit a range remembered from the request or prior knowledge. Review and correct the program's candidates against the executed evidence. The host validates this typed action and the successful submission ends the loop. Do not run another repository program unless refinement explicitly reports missing required navigation and calls remain.

${buildProgramRules(maxResults, maxToolCalls, enableLsp)}${enableLsp ? buildLspRules() : ""}

Authoritative TypeAgent action schema:
${actionSchema}

Authoritative Code Mode repository schema:
${repositorySchema}`;
}

function buildLspRules(): string {
    return `
- This LSP treatment must call repo.lsp at least once. Use a grep result to supply its path, 1-based line hint, and source identifier as symbol. The host resolves the nearest exact identifier in that file when the hint points inside a function body or multiline call. Prefer definition; use references only after narrowing to a strong candidate.
- Refinement cannot complete until at least one repo.lsp call finishes without an error. An empty location array is a valid language-server response and must not be retried solely because it is empty; LSP location counts remain visible in telemetry.
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
- Every program must be a complete string beginning exactly with async function execute(repo: RepositoryApi, params: ExploreParams): Promise<DiscoveryProgramResult> { for discovery or async function execute(repo: RepositoryApi, params: ExploreParams): Promise<RefinementProgramResult> { for refinement, and ending with }. Never send only the function body or use ExploreProgramResult as the return type.
- Discovery and all refinements share one budget of at most ${maxToolCalls} repository calls.
- Start with exact task clues; narrow broad or truncated searches before reading; follow task- or evidence-indicated companion sites; read every submitted range; stop after all indicated sites are verified.
- grep uses safe regular expressions by default; literal is only for fixed strings.
- repo.grep returns { matches: GrepMatch[], truncated: boolean }. Use result.matches, and when result.truncated is true, narrow the pattern or path before treating the search as complete.
- Type empty accumulators explicitly, for example const matches: GrepMatch[] = []; never rely on inference from an untyped [].
- repo.read returns { text, location }. Build every refinement location from defined read result.location values; grep and LSP locate candidates but do not ground final citation ranges. Never reconstruct a read range from its requested offset or limit because the file may end earlier.
- Treat historical paths and line numbers as clues and verify them against current repository contents.
- Repository call results are captured automatically. Discovery should return { success: true, locations: [] }. Refinement must return { success: true, locations: [...] } after inspection; derive candidate locations from its repository results when navigation changes the candidate.
- Submit no more than ${maxResults} final locations for the exact lines or line ranges most likely needing changes. The final typed submitExploration action must review the executed refinement evidence rather than blindly repeat the program candidate. Do not automatically submit an entire read window or fabricate repository contents or ranges.`;
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
    submissionAction: ExploreInvocationTelemetry["submissionAction"],
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
        ...(submissionAction ? { submissionAction } : {}),
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
