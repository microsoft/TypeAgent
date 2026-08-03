// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CopilotClient,
    RuntimeConnection,
    ToolSet,
    type AssistantUsageData,
    type CustomAgentConfig,
    type MCPStdioServerConfig,
    type PermissionHandler,
    type SessionEvent,
} from "@github/copilot-sdk";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
    createCopilotExplorationTools,
    type CopilotExplorationTools,
} from "./copilotTools.js";
import { readEnvFile, redact } from "./io.js";
import { parseFinalAnswer } from "./score.js";
import type {
    BenchmarkAgentConfig,
    BenchmarkVariant,
    CopilotToolCallTrace,
    CopilotTraceItem,
    CopilotUsage,
    ExploreInvocationTelemetry,
    ExploreTelemetry,
    ExplorerSubagentTrace,
    McpServerConfig,
    McpToolCallTrace,
    RunLatencyTimeline,
    RunTrajectoryFiles,
    TokenUsage,
    TypeAgentUsage,
} from "./types.js";
import type { TrajectoryExpectation } from "./trajectory.js";
import { BENCHMARK_TOOL_CALL_LIMIT, isTypeAgentVariant } from "./types.js";
import {
    codeModeTrajectoryInvocationCount,
    codeModeTrajectoryFiles,
    mergeCopilotEvents,
    normalizeCopilotTrajectory,
    validateTrajectoryFile,
    writeUnavailableTrajectoryFile,
    writeTrajectoryFile,
} from "./trajectory.js";

// Copilot uses modelId only for its built-in agent behavior, tool, and token
// limit profile. wireModel below is the exact Luna/Terra/Sol route sent to
// LiteLLM for inference.
const COPILOT_BEHAVIOR_MODEL_ID = "gpt-5";
const TELEMETRY_SETTLE_TIMEOUT_MS = 90_000;
const TELEMETRY_POLL_INTERVAL_MS = 250;
const TREATMENT_REASONING_REQUEST_TIMEOUT_MS = 120_000;
const BENCHMARK_OWNED_MCP_ARGUMENTS = new Set([
    "--repo",
    "--model",
    "--base-url",
    "--api-key-env",
    "--max-tool-calls",
    "--telemetry-file",
    "--trajectory-file",
    "--request-timeout-ms",
    "--enable-lsp",
    "--python-lsp-command",
    "--python-lsp-arg",
    "--typescript-lsp-command",
    "--typescript-lsp-arg",
    "--lsp-server-command",
    "--lsp-server-arg",
    "--disable-lsp-server",
    "--lsp-only-server",
]);

export const COPILOT_SDK_VERSION = "1.0.4";

const benchmarkOutputContract = `Use static inspection only from the current repository root. Do not scan outside the repository. Do not edit files, install dependencies, run tests, run project code, or write patches.
Your final response MUST be only this XML block, with no markdown and no prose outside it:
<final_answer>
path/to/file.ext:10-20
path/to/other.ext:5
</final_answer>
Return at most six repository-relative file paths with exact line or line ranges most likely needing changes.
If evidence is weak, still output the closest file:line locations inside the block.`;

export function buildBenchmarkSystemMessage(variant: BenchmarkVariant): string {
    const requiredPath = isTypeAgentVariant(variant)
        ? `You are the default main agent in an evaluation benchmark.
The TypeAgent MCP explore tool is available. Your first assistant action MUST be exactly one call to it. Do not request another tool or include prose in that action. The host relays a successful result and ends the turn, so do not add prose or call another tool after explore.
Call explore with no arguments. The server binds the complete current user message to this session. Historical lines are clues rather than guaranteed current locations.`
        : `You are the default main agent in an evaluation benchmark.
Your first assistant action MUST delegate to the \`explorer\` subagent with the \`task\` tool, and you must complete exactly one successful delegation. Provide every required task argument: \`description\`, \`prompt\`, \`agent_type: "explorer"\`, \`name\`, and \`mode: "sync"\`. If the task schema is rejected before the subagent starts, correct it and retry. Do not request another tool or include prose in the first action. Pass the complete query and problem statement to the subagent, including reproduction details, exact identifiers, errors, and historical line references.
Copy the complete user message byte-for-byte into the task prompt argument. Do not add, remove, summarize, reformat, or paraphrase any character.
Wait for the explorer subagent to finish. Do not inspect the repository yourself. Then return only the explorer's repository locations in the required output format.`;
    return `${requiredPath}\n${benchmarkOutputContract}`;
}

export function buildBenchmarkPrompt(
    variant: BenchmarkVariant,
    query: string,
): string {
    return query;
}

export interface CopilotHarnessOptions {
    copilotPath: string;
    baseDirectory: string;
    workingDirectory: string;
}

export interface CopilotRunOptions {
    rowName: string;
    attempt: number;
    repoPath: string;
    prompt: string;
    model: string;
    variant: BenchmarkVariant;
    providerBaseUrl: string;
    apiKeyEnv: string;
    agent: BenchmarkAgentConfig;
    envFile?: string;
    mcp: McpServerConfig;
    telemetryFile: string;
    trajectoryFiles: RunTrajectoryFiles;
    timeoutMs: number;
    ripgrepPath: string;
}

export interface CopilotToolInspection {
    attemptedExploreCalls: number;
    completedExploreCalls: number;
    successfulExploreCalls: number;
    firstAssistantActionExclusiveExplore: boolean;
    exploreCompletedBeforeLaterAssistantAction: boolean;
    outsideExploreInspection: boolean;
    attemptedExplorerDelegations: number;
    completedExplorerDelegations: number;
    successfulExplorerDelegations: number;
    failedExplorerDelegations: number;
    explorerRepositoryCalls: number;
    firstAssistantActionExclusiveExplorer: boolean;
    explorerCompletedBeforeLaterAssistantAction: boolean;
    mainAgentRepositoryInspection: boolean;
    explorerSubagentTrace: ExplorerSubagentTrace[];
    mcpToolTrace: McpToolCallTrace[];
}

export interface AgentRoutingConfig {
    availableTools: string[];
    customAgents?: CustomAgentConfig[];
    defaultAgent?: { excludedTools: string[] };
}

export interface CopilotRunOutput {
    ok: boolean;
    durationMs: number;
    latencyTimeline: RunLatencyTimeline;
    finalAnswer: string;
    usage?: CopilotUsage;
    typeAgentUsage?: TypeAgentUsage;
    combinedUsage?: TokenUsage;
    exploreTelemetry?: ExploreTelemetry;
    telemetryFile: string;
    trajectoryFiles: RunTrajectoryFiles;
    attemptedExploreCalls: number;
    completedExploreCalls: number;
    successfulExploreCalls: number;
    outsideExploreInspection: boolean;
    mcpServerReady: boolean;
    mcpAdvertisedTools: string[];
    telemetryError?: string;
    mcpAdopted: boolean;
    lspAdopted: boolean;
    lspCallCount: number;
    lspResultCount: number;
    usedRepair: boolean;
    outerLoopAbortedAfterExplore: boolean;
    mcpToolTrace: McpToolCallTrace[];
    toolTrace: CopilotToolCallTrace[];
    events: CopilotTraceItem[];
    subagentAdopted: boolean;
    defaultMainAgent: boolean;
    attemptedExplorerDelegations: number;
    completedExplorerDelegations: number;
    successfulExplorerDelegations: number;
    failedExplorerDelegations: number;
    explorerRepositoryCalls: number;
    firstAssistantActionExclusiveExplore: boolean;
    exploreCompletedBeforeLaterAssistantAction: boolean;
    firstAssistantActionExclusiveExplorer: boolean;
    explorerCompletedBeforeLaterAssistantAction: boolean;
    mainAgentRepositoryInspection: boolean;
    explorerSubagentTrace: ExplorerSubagentTrace[];
    selectedAgentName?: string;
    error?: string;
}

export interface TypeAgentRelayResult {
    finalAnswer: string;
    outerLoopAbortedAfterExplore: true;
}

export interface TypeAgentRelaySession {
    abort(): Promise<void>;
    on(handler: (event: SessionEvent) => void): () => void;
    send(options: { prompt: string }): Promise<string>;
}

export async function relayTypeAgentExplore(
    session: TypeAgentRelaySession,
    prompt: string,
    timeoutMs: number,
): Promise<TypeAgentRelayResult> {
    const deadline = Date.now() + timeoutMs;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    let exploreCallId: string | undefined;
    let exploreContent: string | undefined;
    let abortPromise: Promise<void> | undefined;
    let abortObserved = false;
    let laterAssistantProse = false;
    let resolveRelay: (() => void) | undefined;
    let rejectRelay: ((error: Error) => void) | undefined;
    const relayComplete = new Promise<void>((resolve, reject) => {
        resolveRelay = resolve;
        rejectRelay = reject;
    });
    const unsubscribe = session.on((event) => {
        if (event.type === "tool.execution_start") {
            const data = recordValue(event.data);
            if (
                data?.mcpServerName === "typeagent" &&
                data.mcpToolName === "explore"
            ) {
                const toolCallId = stringValue(data.toolCallId);
                if (!toolCallId || exploreCallId) {
                    rejectRelay?.(
                        new Error(
                            "TypeAgent relay observed an invalid or duplicate explore start",
                        ),
                    );
                    return;
                }
                exploreCallId = toolCallId;
            }
            return;
        }
        if (event.type === "tool.execution_complete") {
            if (event.data.toolCallId !== exploreCallId) {
                return;
            }
            if (event.data.success !== true) {
                rejectRelay?.(
                    new Error(
                        event.data.error?.message ??
                            "TypeAgent explore completed without relay content",
                    ),
                );
                return;
            }
            try {
                exploreContent = exactNativeExploreText(event.data.result);
            } catch (error) {
                rejectRelay?.(error as Error);
                return;
            }
            if (!abortPromise) {
                abortPromise = session.abort();
                void abortPromise.catch((error) => {
                    rejectRelay?.(
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                    );
                });
            }
            return;
        }
        if (event.type === "abort" && exploreContent !== undefined) {
            abortObserved = true;
            return;
        }
        if (
            exploreContent !== undefined &&
            ((event.type === "assistant.message" &&
                event.data.content.trim().length > 0) ||
                event.type === "assistant.message_delta" ||
                event.type === "assistant.streaming_delta")
        ) {
            laterAssistantProse = true;
            return;
        }
        if (event.type === "session.idle") {
            if (
                exploreContent !== undefined &&
                abortObserved &&
                event.data.aborted === true
            ) {
                resolveRelay?.();
            } else {
                rejectRelay?.(
                    new Error(
                        "TypeAgent relay reached idle without an observed abort after explore",
                    ),
                );
            }
        }
    });

    try {
        await withTimeout(
            session.send({ prompt }),
            remainingMs(),
            "TypeAgent explore send acknowledgement timed out",
        );
        await withTimeout(
            relayComplete,
            remainingMs(),
            "TypeAgent explore relay timed out",
        );
        if (!abortPromise) {
            throw new Error("TypeAgent explore abort was not requested");
        }
        await withTimeout(
            abortPromise,
            remainingMs(),
            "TypeAgent explore abort acknowledgement timed out",
        );
        if (!exploreContent || laterAssistantProse) {
            throw new Error(
                laterAssistantProse
                    ? "TypeAgent outer agent emitted prose after explore"
                    : "TypeAgent explore relay content is missing",
            );
        }
        return {
            finalAnswer: `<final_answer>\n${exploreContent}\n</final_answer>`,
            outerLoopAbortedAfterExplore: true,
        };
    } finally {
        unsubscribe();
    }
}

function exactNativeExploreText(
    result:
        | Extract<
              SessionEvent,
              { type: "tool.execution_complete" }
          >["data"]["result"]
        | undefined,
): string {
    const contents = result?.contents;
    const block = contents?.length === 1 ? contents[0] : undefined;
    if (
        !block ||
        block.type !== "text" ||
        typeof block.text !== "string" ||
        !block.text.trim()
    ) {
        throw new Error(
            "TypeAgent explore must return exactly one non-empty native text block",
        );
    }
    return block.text;
}

export async function resolveCopilotPath(preferred?: string): Promise<string> {
    const candidates = [
        preferred,
        process.env.COPILOT_CLI_PATH,
        resolvePlatformCopilotPackage(),
        findOnPath(`copilot-${process.platform}-${process.arch}`),
        path.join(
            os.homedir(),
            ".bun",
            "bin",
            `copilot-${process.platform}-${process.arch}`,
        ),
    ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

    for (const candidate of candidates) {
        try {
            await access(candidate, constants.X_OK);
            const resolved = await realpath(candidate);
            if (!resolved.endsWith(".js") && !resolved.includes("npm-loader")) {
                return resolved;
            }
        } catch {
            // Try the next native candidate.
        }
    }
    throw new Error(
        "Native GitHub Copilot CLI not found. Install @github/copilot, pass --copilot, or set COPILOT_CLI_PATH.",
    );
}

export function createCopilotClient(
    options: CopilotHarnessOptions,
): CopilotClient {
    return new CopilotClient({
        mode: "empty",
        connection: RuntimeConnection.forStdio({ path: options.copilotPath }),
        baseDirectory: options.baseDirectory,
        workingDirectory: options.workingDirectory,
        useLoggedInUser: false,
        logLevel: "error",
        env: safeRuntimeEnvironment(),
    });
}

export async function stopCopilotClient(client: CopilotClient): Promise<void> {
    try {
        const errors = await withTimeout(
            client.stop(),
            15_000,
            "Copilot CLI graceful shutdown timed out",
        );
        if (errors.length > 0) {
            throw new Error(errors.map((error) => error.message).join("; "));
        }
    } catch (error) {
        await client.forceStop();
        throw error;
    }
}

export async function runCopilot(
    client: CopilotClient,
    options: CopilotRunOptions,
): Promise<CopilotRunOutput> {
    const started = Date.now();
    const elapsedMs = () => Math.max(0, Date.now() - started);
    const latencyTimeline: RunLatencyTimeline = {
        schemaVersion: 1,
        runStartedAt: new Date(started).toISOString(),
        completedMs: 0,
    };
    const events: CopilotTraceItem[] = [];
    const usageEvents: AssistantUsageData[] = [];
    const trajectoryEvents: SessionEvent[] = [];
    const toolTrace: CopilotToolCallTrace[] = [];
    let finalAnswer = "";
    let caughtError: string | undefined;
    let usage: CopilotUsage | undefined;
    let completionUsageComplete = true;
    let usedRepair = false;
    let outerLoopAbortedAfterExplore = false;
    let mcpServerReady = false;
    let mcpAdvertisedTools: string[] = [];
    let selectedAgentName: string | undefined;
    let defaultMainAgent = false;
    let session:
        | Awaited<ReturnType<CopilotClient["createSession"]>>
        | undefined;
    let explorationTools: CopilotExplorationTools | undefined;
    let secret = "";
    let trajectorySecrets: string[] = [];
    let trajectoryFiles = options.trajectoryFiles;

    try {
        const environment = await resolveEnvironment(
            options.apiKeyEnv,
            options.envFile,
        );
        secret = environment[options.apiKeyEnv] ?? "";
        trajectorySecrets = [
            ...new Set(
                [options.apiKeyEnv, ...options.mcp.envVars]
                    .map((name) => environment[name])
                    .filter((value): value is string => Boolean(value)),
            ),
        ];
        explorationTools =
            options.variant === "baseline"
                ? await createCopilotExplorationTools(
                      options.repoPath,
                      toolTrace,
                      BENCHMARK_TOOL_CALL_LIMIT,
                      options.ripgrepPath,
                  )
                : undefined;
        const routing = buildAgentRoutingConfig(options.variant, options.agent);
        const mcpServers = isTypeAgentVariant(options.variant)
            ? {
                  typeagent: buildMcpServerConfig(
                      options,
                      environment,
                      options.ripgrepPath,
                  ),
              }
            : undefined;

        latencyTimeline.sessionCreateStartedMs = elapsedMs();
        session = await client.createSession({
            model: options.model,
            provider: {
                type: "openai",
                baseUrl: options.providerBaseUrl,
                apiKey: secret,
                wireApi: "responses",
                modelId: COPILOT_BEHAVIOR_MODEL_ID,
                wireModel: options.model,
            },
            workingDirectory: options.repoPath,
            tools: explorationTools ?? [],
            ...routing,
            ...(mcpServers ? { mcpServers } : {}),
            customAgentsLocalOnly: true,
            onPermissionRequest: permissionHandler(options.variant),
            onEvent: (event) => {
                trajectoryEvents.push(event);
                recordEvent(events, usageEvents, event, started);
            },
            systemMessage: {
                mode: "replace",
                content: buildBenchmarkSystemMessage(options.variant),
            },
            enableConfigDiscovery: false,
            skipCustomInstructions: true,
            enableOnDemandInstructionDiscovery: false,
            enableFileHooks: false,
            enableSkills: false,
            enableSessionStore: false,
            skipEmbeddingRetrieval: true,
            memory: { enabled: false },
            infiniteSessions: { enabled: false },
            coauthorEnabled: false,
        });
        latencyTimeline.sessionCreatedMs = elapsedMs();

        const selectedAgent = await session.rpc.agent.getCurrent();
        selectedAgentName = selectedAgent.agent?.name;
        defaultMainAgent = selectedAgent.agent === null;
        if (!defaultMainAgent) {
            throw new Error(
                `Copilot selected custom agent ${JSON.stringify(selectedAgentName)} instead of retaining the default main agent`,
            );
        }

        if (options.variant === "baseline") {
            const agents = await session.rpc.agent.list();
            const explorer = agents.agents.filter(
                (agent) => agent.name === options.agent.name,
            );
            if (
                explorer.length !== 1 ||
                JSON.stringify(explorer[0].tools) !==
                    JSON.stringify(options.agent.tools)
            ) {
                throw new Error(
                    `Baseline must register exactly one explorer subagent with ${JSON.stringify(options.agent.tools)}; observed ${JSON.stringify(explorer)}`,
                );
            }
        }

        if (isTypeAgentVariant(options.variant)) {
            await waitForMcpServer(session, "typeagent", 15_000);
            mcpServerReady = true;
            const listed = await session.rpc.mcp.listTools({
                serverName: "typeagent",
            });
            mcpAdvertisedTools = listed.tools.map((tool) => tool.name).sort();
            if (
                mcpAdvertisedTools.length !== 1 ||
                mcpAdvertisedTools[0] !== "explore"
            ) {
                throw new Error(
                    `TypeAgent MCP must advertise only explore; observed ${JSON.stringify(mcpAdvertisedTools)}`,
                );
            }
            latencyTimeline.mcpReadyMs = elapsedMs();
        }

        const prompt = buildBenchmarkPrompt(options.variant, options.prompt);
        try {
            latencyTimeline.primaryTurnStartedMs = elapsedMs();
            try {
                if (isTypeAgentVariant(options.variant)) {
                    const relay = await relayTypeAgentExplore(
                        session,
                        prompt,
                        options.timeoutMs,
                    );
                    finalAnswer = relay.finalAnswer;
                    outerLoopAbortedAfterExplore =
                        relay.outerLoopAbortedAfterExplore;
                } else {
                    const reply = await session.sendAndWait(
                        { prompt },
                        options.timeoutMs,
                    );
                    finalAnswer = reply?.data.content ?? "";
                }
            } finally {
                latencyTimeline.primaryTurnCompletedMs = elapsedMs();
            }
            if (
                options.variant === "baseline" &&
                shouldRepairFinalAnswer(finalAnswer, options.repoPath)
            ) {
                latencyTimeline.repairTurnStartedMs = elapsedMs();
                let repaired: Awaited<ReturnType<typeof session.sendAndWait>>;
                try {
                    repaired = await session.sendAndWait(
                        {
                            prompt: `Your previous answer did not use the required machine-readable localization format. Convert it now using only evidence already gathered. Do not call any tool. Return ONLY:\n<final_answer>\npath/to/file.py:line-or-start-end\n</final_answer>\nNo markdown, no bullets, no code blocks, no prose outside the XML block.`,
                        },
                        options.timeoutMs,
                    );
                } finally {
                    latencyTimeline.repairTurnCompletedMs = elapsedMs();
                }
                finalAnswer = repaired?.data.content ?? finalAnswer;
                usedRepair = true;
            }
        } catch (error) {
            completionUsageComplete = false;
            await abortQuietly(session);
            throw error;
        }
        latencyTimeline.responseReadyMs =
            latencyTimeline.repairTurnCompletedMs ??
            latencyTimeline.primaryTurnCompletedMs;
        latencyTimeline.usageReadStartedMs = elapsedMs();
        usage = await readSessionUsage(session, usageEvents);
        latencyTimeline.usageReadCompletedMs = elapsedMs();
        if (!usage) {
            throw new Error("Copilot CLI returned no token usage");
        }
        const usageModelError = validateObservedUsageModels(
            usage,
            options.model,
        );
        if (usageModelError) {
            throw new Error(usageModelError);
        }
    } catch (error) {
        caughtError = redact((error as Error).message, [secret]);
        if (session && !usage) {
            latencyTimeline.usageReadStartedMs ??= elapsedMs();
            try {
                usage = await readSessionUsage(session, usageEvents);
            } catch (usageError) {
                caughtError = [
                    caughtError,
                    redact((usageError as Error).message, [secret]),
                ]
                    .filter(Boolean)
                    .join("\n");
            }
            latencyTimeline.usageReadCompletedMs = elapsedMs();
        }
        if (usage && !completionUsageComplete) {
            usage = { ...usage, usageComplete: false };
        }
    } finally {
        try {
            let persistedEvents: SessionEvent[] = [];
            if (session) {
                try {
                    persistedEvents = await session.getEvents();
                } catch {
                    // Live events remain authoritative when session storage is disabled.
                }
            }
            const trajectory = normalizeCopilotTrajectory(
                mergeCopilotEvents(persistedEvents, trajectoryEvents),
                options.model,
                trajectorySecrets,
                {
                    system: buildBenchmarkSystemMessage(options.variant),
                    user: buildBenchmarkPrompt(options.variant, options.prompt),
                    ...(caughtError ? { failure: caughtError } : {}),
                },
            );
            await writeTrajectoryFile(trajectoryFiles.main, trajectory);
            await validateTrajectoryFile(
                trajectoryFiles.main,
                trajectoryExpectation(options, "main"),
            );
        } catch (error) {
            caughtError = [
                caughtError,
                `Main trajectory capture failed: ${redact((error as Error).message, [secret])}`,
            ]
                .filter(Boolean)
                .join("\n");
        }
        if (session) {
            latencyTimeline.disconnectStartedMs = elapsedMs();
            try {
                await withTimeout(
                    session.disconnect(),
                    10_000,
                    "Copilot session disconnect timed out",
                );
            } catch (error) {
                caughtError ??= redact((error as Error).message, [secret]);
            } finally {
                latencyTimeline.disconnectedMs = elapsedMs();
            }
        }
        try {
            await explorationTools?.close();
        } catch (error) {
            caughtError ??= redact((error as Error).message, [secret]);
        }
        latencyTimeline.cleanupCompletedMs = elapsedMs();
    }

    const inspection = inspectCopilotToolTrace(events);
    let exploreTelemetry: ExploreTelemetry | undefined;
    let telemetryError: string | undefined;
    let trajectoryError: string | undefined;
    if (isTypeAgentVariant(options.variant)) {
        latencyTimeline.telemetryReadStartedMs = elapsedMs();
        try {
            exploreTelemetry = await readExploreTelemetryEventually(
                options.telemetryFile,
                options.model,
                caughtError && inspection.attemptedExploreCalls > 0
                    ? Math.min(options.timeoutMs, TELEMETRY_SETTLE_TIMEOUT_MS)
                    : 0,
            );
        } catch (error) {
            telemetryError = (error as Error).message;
        } finally {
            latencyTimeline.telemetryReadCompletedMs = elapsedMs();
        }
        const codeModeFile = trajectoryFiles.codeMode;
        if (codeModeFile) {
            trajectoryFiles = {
                ...trajectoryFiles,
                codeModeInvocations: codeModeTrajectoryFiles(
                    codeModeFile,
                    codeModeTrajectoryInvocationCount(
                        inspection.attemptedExploreCalls,
                        exploreTelemetry?.invocations?.length,
                    ),
                ),
            };
        }
        try {
            if (!trajectoryFiles.codeMode) {
                throw new Error("Code Mode trajectory path is missing");
            }
            const codeModeFiles = trajectoryFiles.codeModeInvocations ?? [
                trajectoryFiles.codeMode,
            ];
            for (const [invocationIndex, file] of codeModeFiles.entries()) {
                const expected = trajectoryExpectation(
                    options,
                    "codemode",
                    invocationIndex,
                );
                try {
                    await validateTrajectoryFile(file, expected);
                } catch (error) {
                    const originalError = error as NodeJS.ErrnoException;
                    const invocation =
                        exploreTelemetry?.invocations?.[invocationIndex];
                    const missingInvocationMayBeUnavailable =
                        invocation === undefined &&
                        (invocationIndex < inspection.attemptedExploreCalls ||
                            (invocationIndex === 0 &&
                                !exploreTelemetry?.invocations?.length));
                    const mayBeUnavailable =
                        originalError.code === "ENOENT" &&
                        (missingInvocationMayBeUnavailable ||
                            (invocation?.status === "failed" &&
                                invocation.usage.requestCount === 0));
                    if (!mayBeUnavailable) {
                        throw error;
                    }
                    await writeUnavailableTrajectoryFile(
                        file,
                        expected,
                        options.prompt,
                        invocation?.error ??
                            caughtError ??
                            "Code Mode did not start",
                        trajectorySecrets,
                    );
                    await validateTrajectoryFile(file, expected);
                }
            }
        } catch (error) {
            trajectoryError = `Code Mode trajectory capture failed: ${(error as Error).message}`;
        }
    }
    const treatmentError = treatmentValidationError(
        options.variant,
        inspection,
        mcpServerReady,
        mcpAdvertisedTools,
        exploreTelemetry,
        telemetryError,
    );
    const relayError = outerRelayValidationError(
        options.variant,
        outerLoopAbortedAfterExplore,
        usedRepair,
        usage?.requestCount,
    );
    const error = [caughtError, treatmentError, relayError, trajectoryError]
        .filter(Boolean)
        .join("\n");
    const lspCalls =
        exploreTelemetry?.toolTrace.calls.filter(
            (call) => call.tool === "lsp",
        ) ?? [];
    const adoptedLspCalls = lspCalls.filter((call) => call.discarded !== true);
    const lspResultCount = lspCalls.reduce(
        (total, call) => total + call.resultCount,
        0,
    );
    const combinedUsage =
        usage &&
        usage.usageComplete !== false &&
        exploreTelemetry &&
        exploreTelemetry.usage.usageComplete !== false
            ? addUsage(usage, exploreTelemetry.usage)
            : options.variant === "baseline" && usage?.usageComplete !== false
              ? usage
              : undefined;
    const ok = Boolean(finalAnswer) && !error;

    latencyTimeline.completedMs = elapsedMs();
    return {
        ok,
        durationMs: latencyTimeline.completedMs,
        latencyTimeline,
        finalAnswer,
        ...(usage ? { usage } : {}),
        ...(exploreTelemetry
            ? {
                  typeAgentUsage: exploreTelemetry.usage,
                  exploreTelemetry,
              }
            : {}),
        ...(combinedUsage ? { combinedUsage } : {}),
        telemetryFile: options.telemetryFile,
        trajectoryFiles,
        attemptedExploreCalls: inspection.attemptedExploreCalls,
        completedExploreCalls: inspection.completedExploreCalls,
        successfulExploreCalls: inspection.successfulExploreCalls,
        outsideExploreInspection: inspection.outsideExploreInspection,
        mcpServerReady,
        mcpAdvertisedTools,
        ...(telemetryError ? { telemetryError } : {}),
        mcpAdopted: inspection.attemptedExploreCalls > 0,
        lspAdopted: adoptedLspCalls.length > 0,
        lspCallCount: lspCalls.length,
        lspResultCount,
        usedRepair,
        outerLoopAbortedAfterExplore,
        mcpToolTrace: inspection.mcpToolTrace,
        toolTrace,
        events,
        subagentAdopted: inspection.attemptedExplorerDelegations > 0,
        defaultMainAgent,
        attemptedExplorerDelegations: inspection.attemptedExplorerDelegations,
        completedExplorerDelegations: inspection.completedExplorerDelegations,
        successfulExplorerDelegations: inspection.successfulExplorerDelegations,
        failedExplorerDelegations: inspection.failedExplorerDelegations,
        explorerRepositoryCalls: inspection.explorerRepositoryCalls,
        firstAssistantActionExclusiveExplore:
            inspection.firstAssistantActionExclusiveExplore,
        exploreCompletedBeforeLaterAssistantAction:
            inspection.exploreCompletedBeforeLaterAssistantAction,
        firstAssistantActionExclusiveExplorer:
            inspection.firstAssistantActionExclusiveExplorer,
        explorerCompletedBeforeLaterAssistantAction:
            inspection.explorerCompletedBeforeLaterAssistantAction,
        mainAgentRepositoryInspection: inspection.mainAgentRepositoryInspection,
        explorerSubagentTrace: inspection.explorerSubagentTrace,
        ...(selectedAgentName ? { selectedAgentName } : {}),
        ...(!ok
            ? {
                  error:
                      error || "Copilot CLI completed without a final answer",
              }
            : {}),
    };
}

function trajectoryExpectation(
    options: CopilotRunOptions,
    system: TrajectoryExpectation["system"],
    invocationIndex?: number,
): TrajectoryExpectation {
    return {
        rowName: options.rowName,
        model: options.model,
        variant: options.variant,
        attempt: options.attempt,
        system,
        ...(invocationIndex !== undefined ? { invocationIndex } : {}),
    };
}

export function buildCustomAgentConfig(
    agent: BenchmarkAgentConfig,
): CustomAgentConfig {
    return {
        name: agent.name,
        displayName: agent.name,
        description: agent.description,
        tools: agent.tools,
        prompt: agent.prompt,
        infer: true,
    };
}

export function buildAgentRoutingConfig(
    variant: BenchmarkVariant,
    agent: BenchmarkAgentConfig,
): AgentRoutingConfig {
    if (isTypeAgentVariant(variant)) {
        return {
            availableTools: new ToolSet().addMcp("*").toArray(),
        };
    }
    return {
        availableTools: new ToolSet()
            .addBuiltIn("task")
            .addCustom("*")
            .toArray(),
        customAgents: [buildCustomAgentConfig(agent)],
        defaultAgent: { excludedTools: [...agent.tools] },
    };
}

export function shouldRepairFinalAnswer(
    finalAnswer: string,
    repoPath?: string,
): boolean {
    return parseFinalAnswer(finalAnswer, repoPath).citations.length === 0;
}

export function validateObservedUsageModels(
    usage: CopilotUsage,
    expectedModel: string,
): string | undefined {
    const observed = [...new Set(usage.models)];
    return observed.length === 1 && observed[0] === expectedModel
        ? undefined
        : `Copilot usage models ${JSON.stringify(observed)} do not match requested route ${JSON.stringify(expectedModel)}`;
}

export function buildMcpServerConfig(
    options: CopilotRunOptions,
    environment: Record<string, string>,
    ripgrepPath: string,
): MCPStdioServerConfig {
    validateBenchmarkMcpArguments(options.mcp);
    const codeModeTrajectory = options.trajectoryFiles.codeMode;
    if (!codeModeTrajectory) {
        throw new Error("TypeAgent MCP requires a Code Mode trajectory path");
    }
    const names = [...new Set([...options.mcp.envVars, options.apiKeyEnv])];
    const env = {
        ...Object.fromEntries(
            names.map((name) => {
                const value = environment[name];
                if (!value) {
                    throw new Error(`Missing MCP environment variable ${name}`);
                }
                return [name, value];
            }),
        ),
        TYPEAGENT_RIPGREP_PATH: ripgrepPath,
        TYPEAGENT_EXPLORE_EXPECTED_QUERY: options.prompt,
    };
    return {
        type: "stdio",
        command: options.mcp.command,
        args: [
            ...options.mcp.args,
            "--request-timeout-ms",
            String(TREATMENT_REASONING_REQUEST_TIMEOUT_MS),
            ...(options.variant === "typeagent-lsp"
                ? [
                      "--enable-lsp",
                      "--python-lsp-command",
                      requiredPythonLspCommand(options.mcp),
                      ...requiredTypeScriptLspArguments(options.mcp),
                      "--lsp-only-server",
                      "pylsp",
                      "--lsp-only-server",
                      "typescript",
                  ]
                : []),
            "--repo",
            options.repoPath,
            "--model",
            options.model,
            "--base-url",
            options.providerBaseUrl,
            "--api-key-env",
            options.apiKeyEnv,
            "--max-tool-calls",
            String(BENCHMARK_TOOL_CALL_LIMIT),
            "--telemetry-file",
            options.telemetryFile,
            "--trajectory-file",
            codeModeTrajectory,
        ],
        env,
        ...(options.mcp.cwd ? { workingDirectory: options.mcp.cwd } : {}),
        tools: ["explore"],
        timeout: Math.max(300_000, options.timeoutMs),
    };
}

export function validateBenchmarkMcpArguments(mcp: McpServerConfig): void {
    const conflicting = mcp.args.find((argument) =>
        BENCHMARK_OWNED_MCP_ARGUMENTS.has(argument.split("=", 1)[0]),
    );
    if (conflicting) {
        throw new Error(
            `Benchmark-owned MCP argument ${JSON.stringify(conflicting)} cannot be overridden`,
        );
    }
}

function requiredPythonLspCommand(mcp: McpServerConfig): string {
    if (!mcp.pythonLspCommand) {
        throw new Error(
            "TypeAgent with LSP requires a pinned Python language-server command",
        );
    }
    return mcp.pythonLspCommand;
}

function requiredTypeScriptLspArguments(mcp: McpServerConfig): string[] {
    if (!mcp.typescriptLspCommand || !mcp.typescriptLspArgs?.[0]) {
        throw new Error(
            "TypeAgent with LSP requires a pinned TypeScript language-server command and entrypoint",
        );
    }
    return [
        "--typescript-lsp-command",
        mcp.typescriptLspCommand,
        ...mcp.typescriptLspArgs.flatMap((argument) => [
            "--typescript-lsp-arg",
            argument,
        ]),
    ];
}

export function inspectCopilotToolTrace(
    events: CopilotTraceItem[],
): CopilotToolInspection {
    const mcpStarts: Array<{
        toolCallId: string;
        server?: string;
        tool?: string;
        arguments?: unknown;
        startedOffsetMs?: number;
    }> = [];
    const taskStarts: Array<{
        toolCallId: string;
        arguments?: unknown;
    }> = [];
    const completions = new Map<
        string,
        {
            success: boolean;
            completedOffsetMs?: number;
            result?: unknown;
            error?: string;
        }
    >();
    const subagentStarts = new Map<
        string,
        { agentId?: string; model?: string }
    >();
    const subagentCompletions = new Map<
        string,
        {
            model?: string;
            durationMs?: number;
            totalTokens?: number;
            totalToolCalls?: number;
        }
    >();
    const subagentFailures = new Map<string, string>();

    for (const event of events) {
        if (event.type === "tool.execution_start") {
            const data = recordValue(event.data);
            const toolCallId = stringValue(data?.toolCallId);
            if (!toolCallId) {
                continue;
            }
            const server = stringValue(data?.mcpServerName);
            const tool = stringValue(data?.mcpToolName);
            if (server === "typeagent" && tool === "explore") {
                const startedOffsetMs = nonNegativeInteger(
                    event.observedAtOffsetMs,
                );
                mcpStarts.push({
                    toolCallId,
                    server,
                    tool,
                    arguments: data?.arguments,
                    ...(startedOffsetMs !== undefined
                        ? { startedOffsetMs }
                        : {}),
                });
            } else if (
                !stringValue(event.agentId) &&
                data?.toolName === "task" &&
                isExplorerTaskTarget(data.arguments)
            ) {
                taskStarts.push({
                    toolCallId,
                    arguments: data.arguments,
                });
            }
        } else if (event.type === "tool.execution_complete") {
            const data = recordValue(event.data);
            const toolCallId = stringValue(data?.toolCallId);
            if (!toolCallId) {
                continue;
            }
            const completedOffsetMs = nonNegativeInteger(
                event.observedAtOffsetMs,
            );
            completions.set(toolCallId, {
                success: data?.success === true,
                ...(completedOffsetMs !== undefined
                    ? { completedOffsetMs }
                    : {}),
                ...(data?.result !== undefined ? { result: data.result } : {}),
                ...(recordValue(data?.error)?.message
                    ? { error: String(recordValue(data?.error)?.message) }
                    : {}),
            });
        } else if (event.type === "subagent.started") {
            const data = recordValue(event.data);
            const toolCallId = stringValue(data?.toolCallId);
            if (toolCallId && data?.agentName === "explorer") {
                const agentId = stringValue(event.agentId);
                const model = stringValue(data.model);
                subagentStarts.set(toolCallId, {
                    ...(agentId ? { agentId } : {}),
                    ...(model ? { model } : {}),
                });
            }
        } else if (event.type === "subagent.completed") {
            const data = recordValue(event.data);
            const toolCallId = stringValue(data?.toolCallId);
            if (toolCallId && data?.agentName === "explorer") {
                const model = stringValue(data.model);
                subagentCompletions.set(toolCallId, {
                    ...(model ? { model } : {}),
                    ...(typeof data.durationMs === "number"
                        ? { durationMs: data.durationMs }
                        : {}),
                    ...(typeof data.totalTokens === "number"
                        ? { totalTokens: data.totalTokens }
                        : {}),
                    ...(typeof data.totalToolCalls === "number"
                        ? { totalToolCalls: data.totalToolCalls }
                        : {}),
                });
            }
        } else if (event.type === "subagent.failed") {
            const data = recordValue(event.data);
            const toolCallId = stringValue(data?.toolCallId);
            if (toolCallId && data?.agentName === "explorer") {
                subagentFailures.set(
                    toolCallId,
                    stringValue(data.error) ?? "Explorer subagent failed",
                );
            }
        }
    }

    const mcpToolTrace = mcpStarts.map((start) => {
        const completion = completions.get(start.toolCallId);
        const { toolCallId, ...details } = start;
        return {
            toolCallId,
            ...details,
            ...(completion?.completedOffsetMs !== undefined &&
            start.startedOffsetMs !== undefined &&
            completion.completedOffsetMs >= start.startedOffsetMs
                ? {
                      durationMs:
                          completion.completedOffsetMs - start.startedOffsetMs,
                  }
                : {}),
            completed: Boolean(completion),
            ...(completion
                ? {
                      success: completion.success,
                      ...(completion.result !== undefined
                          ? { result: compactValue(completion.result) }
                          : {}),
                      ...(completion.error ? { error: completion.error } : {}),
                  }
                : {}),
        } satisfies McpToolCallTrace;
    });
    const explorerSubagentTrace = taskStarts.map((start) => {
        const childStart = subagentStarts.get(start.toolCallId);
        const childCompletion = subagentCompletions.get(start.toolCallId);
        const childFailure = subagentFailures.get(start.toolCallId);
        const taskCompletion = completions.get(start.toolCallId);
        const completed = Boolean(childCompletion && taskCompletion);
        const success =
            completed && taskCompletion?.success === true && !childFailure;
        const model = childCompletion?.model ?? childStart?.model;
        const resultContent = stringValue(
            recordValue(taskCompletion?.result)?.content,
        );
        return {
            toolCallId: start.toolCallId,
            ...(childStart?.agentId ? { agentId: childStart.agentId } : {}),
            agentName: "explorer",
            ...(start.arguments !== undefined
                ? { arguments: compactValue(start.arguments) }
                : {}),
            started: Boolean(childStart),
            completed,
            success,
            ...(model ? { model } : {}),
            ...(childCompletion?.durationMs !== undefined
                ? { durationMs: childCompletion.durationMs }
                : {}),
            ...(childCompletion?.totalTokens !== undefined
                ? { totalTokens: childCompletion.totalTokens }
                : {}),
            ...(childCompletion?.totalToolCalls !== undefined
                ? { totalToolCalls: childCompletion.totalToolCalls }
                : {}),
            ...(resultContent ? { resultContent } : {}),
            ...(childFailure
                ? { error: childFailure }
                : taskCompletion?.error
                  ? { error: taskCompletion.error }
                  : {}),
        } satisfies ExplorerSubagentTrace;
    });
    const explorerAgentIds = new Set(
        [...subagentStarts.values()]
            .map((start) => start.agentId)
            .filter((agentId): agentId is string => Boolean(agentId)),
    );
    const explorerTaskIds = new Set(
        taskStarts.map((start) => start.toolCallId),
    );
    let outsideExploreInspection = false;
    let mainAgentRepositoryInspection = false;
    let explorerRepositoryCalls = 0;
    for (const event of events) {
        if (event.type !== "tool.execution_start") {
            continue;
        }
        const data = recordValue(event.data);
        const toolCallId = stringValue(data?.toolCallId);
        const agentId = stringValue(event.agentId);
        const isExplore =
            !agentId &&
            data?.mcpServerName === "typeagent" &&
            data.mcpToolName === "explore";
        const isExplorerTask =
            !agentId && Boolean(toolCallId && explorerTaskIds.has(toolCallId));
        const isExplorerRepositoryTool =
            Boolean(agentId && explorerAgentIds.has(agentId)) &&
            ["read", "grep", "glob", "bash"].includes(
                stringValue(data?.toolName) ?? "",
            );
        if (!isExplore) {
            outsideExploreInspection = true;
        }
        if (isExplorerRepositoryTool) {
            explorerRepositoryCalls += 1;
        } else if (!isExplore && !isExplorerTask) {
            mainAgentRepositoryInspection = true;
        }
    }
    const firstExploreAction = inspectFirstExploreAction(events);
    const firstExplorerAction = inspectFirstExplorerTaskAction(events);
    return {
        attemptedExploreCalls: mcpStarts.length,
        completedExploreCalls: mcpToolTrace.filter((call) => call.completed)
            .length,
        successfulExploreCalls: mcpToolTrace.filter(
            (call) => call.completed && call.success === true,
        ).length,
        firstAssistantActionExclusiveExplore:
            firstExploreAction.exclusiveExploreRequest,
        exploreCompletedBeforeLaterAssistantAction:
            firstExploreAction.completedBeforeLaterAssistantAction,
        outsideExploreInspection,
        attemptedExplorerDelegations: taskStarts.length,
        completedExplorerDelegations: explorerSubagentTrace.filter(
            (call) => call.completed,
        ).length,
        successfulExplorerDelegations: explorerSubagentTrace.filter(
            (call) => call.success === true,
        ).length,
        failedExplorerDelegations: explorerSubagentTrace.filter(
            (call) => call.error,
        ).length,
        explorerRepositoryCalls,
        firstAssistantActionExclusiveExplorer:
            firstExplorerAction.exclusiveExplorerRequest,
        explorerCompletedBeforeLaterAssistantAction:
            firstExplorerAction.completedBeforeLaterAssistantAction,
        mainAgentRepositoryInspection,
        explorerSubagentTrace,
        mcpToolTrace,
    };
}

export function treatmentValidationError(
    variant: BenchmarkVariant,
    inspection: CopilotToolInspection,
    mcpServerReady: boolean,
    mcpAdvertisedTools: string[],
    telemetry?: ExploreTelemetry,
    telemetryError?: string,
): string | undefined {
    if (variant === "baseline") {
        if (inspection.attemptedExploreCalls !== 0) {
            return `Baseline unexpectedly invoked TypeAgent explore ${inspection.attemptedExploreCalls} time(s).`;
        }
        if (inspection.attemptedExplorerDelegations < 1) {
            return "Baseline requires at least one explorer subagent attempt.";
        }
        if (
            inspection.completedExplorerDelegations !== 1 ||
            inspection.successfulExplorerDelegations !== 1
        ) {
            return "Baseline requires exactly one successful explorer subagent delegation.";
        }
        if (!inspection.firstAssistantActionExclusiveExplorer) {
            return "Baseline requires the first assistant action to contain no prose and exactly one synchronous explorer task.";
        }
        if (!inspection.explorerCompletedBeforeLaterAssistantAction) {
            return "Baseline requires the synchronous explorer task to start and complete before any later main-agent assistant action.";
        }
        if (inspection.mainAgentRepositoryInspection) {
            return "Baseline default main agent inspected the repository instead of delegating exclusively to explorer.";
        }
        if (inspection.explorerRepositoryCalls < 1) {
            return "Baseline explorer subagent completed without using a repository inspection tool.";
        }
        return undefined;
    }
    if (inspection.attemptedExplorerDelegations !== 0) {
        return `TypeAgent treatment unexpectedly delegated to explorer ${inspection.attemptedExplorerDelegations} time(s).`;
    }
    if (!mcpServerReady) {
        return "TypeAgent MCP server was not running before the treatment turn.";
    }
    if (
        mcpAdvertisedTools.length !== 1 ||
        mcpAdvertisedTools[0] !== "explore"
    ) {
        return `TypeAgent MCP must advertise only explore; observed ${JSON.stringify(mcpAdvertisedTools)}.`;
    }
    if (inspection.attemptedExploreCalls !== 1) {
        return `TypeAgent treatment requires exactly one explore attempt; observed ${inspection.attemptedExploreCalls}.`;
    }
    if (inspection.completedExploreCalls !== 1) {
        return `TypeAgent treatment requires exactly one completed explore invocation; observed ${inspection.completedExploreCalls}.`;
    }
    if (inspection.successfulExploreCalls !== 1) {
        return `TypeAgent treatment requires one successful explore invocation; observed ${inspection.successfulExploreCalls}.`;
    }
    if (!inspection.firstAssistantActionExclusiveExplore) {
        return "TypeAgent treatment requires the first assistant action to contain no prose and exactly one TypeAgent explore request.";
    }
    if (!inspection.exploreCompletedBeforeLaterAssistantAction) {
        return "TypeAgent treatment requires explore to start and complete before any later assistant action.";
    }
    if (inspection.outsideExploreInspection) {
        return "TypeAgent treatment used a repository inspection tool outside explore.";
    }
    if (telemetryError) {
        return `TypeAgent explore telemetry is invalid: ${telemetryError}`;
    }
    if (!telemetry) {
        return "TypeAgent explore telemetry is missing.";
    }
    if (telemetry.status !== "completed") {
        return `TypeAgent explore telemetry status is ${telemetry.status}.`;
    }
    if (telemetry.usage.usageComplete === false) {
        return "TypeAgent explore model usage is incomplete.";
    }
    if (telemetry.schemaVersion !== 1 && telemetry.invocations?.length !== 1) {
        return `TypeAgent treatment requires telemetry for exactly one explore invocation; observed ${telemetry.invocations?.length ?? 0}.`;
    }
    if (variant === "typeagent-lsp") {
        const adoptedLspNavigation = telemetry.toolTrace.calls.some(
            (call) => call.tool === "lsp" && call.discarded !== true,
        );
        if (!adoptedLspNavigation) {
            return "TypeAgent with LSP requires at least one non-discarded language-server navigation attempt.";
        }
    }
    return undefined;
}

export function outerRelayValidationError(
    variant: BenchmarkVariant,
    outerLoopAbortedAfterExplore: boolean,
    usedRepair: boolean,
    outerRequestCount: number | undefined,
): string | undefined {
    if (!isTypeAgentVariant(variant)) {
        return undefined;
    }
    if (!outerLoopAbortedAfterExplore) {
        return "TypeAgent treatment did not abort the outer loop after explore.";
    }
    if (usedRepair) {
        return "TypeAgent treatment unexpectedly used an outer repair turn.";
    }
    return outerRequestCount === 1
        ? undefined
        : `TypeAgent treatment requires exactly one outer model request; observed ${outerRequestCount ?? 0}.`;
}

function inspectFirstExplorerTaskAction(events: CopilotTraceItem[]): {
    exclusiveExplorerRequest: boolean;
    completedBeforeLaterAssistantAction: boolean;
} {
    const firstAssistantIndex = events.findIndex(
        (event) =>
            event.type === "assistant.message" && !stringValue(event.agentId),
    );
    if (firstAssistantIndex < 0) {
        return {
            exclusiveExplorerRequest: false,
            completedBeforeLaterAssistantAction: false,
        };
    }

    const data = recordValue(events[firstAssistantIndex].data);
    const content = stringValue(data?.content) ?? "";
    const requests = Array.isArray(data?.toolRequests) ? data.toolRequests : [];
    const request =
        requests.length === 1 ? recordValue(requests[0]) : undefined;
    const toolCallId = stringValue(request?.toolCallId);
    const exclusiveExplorerRequest =
        content.trim().length === 0 &&
        requests.length === 1 &&
        Boolean(toolCallId) &&
        request?.name === "task" &&
        isExplorerTaskRequestArguments(request.arguments);
    if (!exclusiveExplorerRequest || !toolCallId) {
        return {
            exclusiveExplorerRequest: false,
            completedBeforeLaterAssistantAction: false,
        };
    }

    const successfulTaskCompletionIndex = events.findIndex((event, index) => {
        if (
            index <= firstAssistantIndex ||
            event.type !== "tool.execution_complete" ||
            stringValue(event.agentId)
        ) {
            return false;
        }
        const completion = recordValue(event.data);
        const completedId = stringValue(completion?.toolCallId);
        if (!completedId || completion?.success !== true) {
            return false;
        }
        return events.some((candidate, candidateIndex) => {
            const child = recordValue(candidate.data);
            return (
                candidateIndex < index &&
                candidate.type === "subagent.completed" &&
                child?.toolCallId === completedId &&
                child.agentName === "explorer"
            );
        });
    });
    const laterAnswerIndex = events.findIndex(
        (event, index) =>
            index > firstAssistantIndex &&
            event.type === "assistant.message" &&
            !stringValue(event.agentId) &&
            Boolean(stringValue(recordValue(event.data)?.content)?.trim()),
    );
    return {
        exclusiveExplorerRequest: true,
        completedBeforeLaterAssistantAction:
            successfulTaskCompletionIndex > firstAssistantIndex &&
            (laterAnswerIndex < 0 ||
                successfulTaskCompletionIndex < laterAnswerIndex),
    };
}

function isExplorerTaskRequestArguments(value: unknown): boolean {
    const args = recordValue(value);
    return (
        args?.agent_type === "explorer" &&
        args.mode === "sync" &&
        Boolean(stringValue(args.prompt)?.trim()) &&
        args.model === undefined
    );
}

function isExplorerTaskTarget(value: unknown): boolean {
    return recordValue(value)?.agent_type === "explorer";
}

function inspectFirstExploreAction(events: CopilotTraceItem[]): {
    exclusiveExploreRequest: boolean;
    completedBeforeLaterAssistantAction: boolean;
} {
    const firstAssistantIndex = events.findIndex(
        (event) =>
            event.type === "assistant.message" && !stringValue(event.agentId),
    );
    if (firstAssistantIndex < 0) {
        return {
            exclusiveExploreRequest: false,
            completedBeforeLaterAssistantAction: false,
        };
    }

    const data = recordValue(events[firstAssistantIndex].data);
    const content = stringValue(data?.content) ?? "";
    const requests = Array.isArray(data?.toolRequests) ? data.toolRequests : [];
    const request =
        requests.length === 1 ? recordValue(requests[0]) : undefined;
    const toolCallId = stringValue(request?.toolCallId);
    const exclusiveExploreRequest =
        content.trim().length === 0 &&
        requests.length === 1 &&
        Boolean(toolCallId) &&
        request?.mcpServerName === "typeagent" &&
        request.mcpToolName === "explore" &&
        isSessionBoundExploreArguments(request.arguments);
    if (!exclusiveExploreRequest || !toolCallId) {
        return {
            exclusiveExploreRequest: false,
            completedBeforeLaterAssistantAction: false,
        };
    }

    const successfulCompletionIndex = events.findIndex((event, index) => {
        if (
            index <= firstAssistantIndex ||
            event.type !== "tool.execution_complete"
        ) {
            return false;
        }
        if (stringValue(event.agentId)) {
            return false;
        }
        const completion = recordValue(event.data);
        const completedId = stringValue(completion?.toolCallId);
        if (!completedId || completion?.success !== true) {
            return false;
        }
        return events.some((candidate, candidateIndex) => {
            const start = recordValue(candidate.data);
            return (
                candidateIndex < index &&
                candidate.type === "tool.execution_start" &&
                start?.toolCallId === completedId &&
                start.mcpServerName === "typeagent" &&
                start.mcpToolName === "explore"
            );
        });
    });
    const laterAnswerIndex = events.findIndex(
        (event, index) =>
            index > firstAssistantIndex &&
            event.type === "assistant.message" &&
            !stringValue(event.agentId) &&
            Boolean(stringValue(recordValue(event.data)?.content)?.trim()),
    );
    return {
        exclusiveExploreRequest: true,
        completedBeforeLaterAssistantAction:
            successfulCompletionIndex > firstAssistantIndex &&
            (laterAnswerIndex < 0 ||
                successfulCompletionIndex < laterAnswerIndex),
    };
}

function isSessionBoundExploreArguments(value: unknown): boolean {
    const args = recordValue(value);
    return (
        args !== undefined &&
        !Object.prototype.hasOwnProperty.call(args, "query")
    );
}

export function summarizeCopilotUsage(
    usageEvents: AssistantUsageData[],
): CopilotUsage | undefined {
    if (usageEvents.length === 0) {
        return undefined;
    }
    const sum = (pick: (usage: AssistantUsageData) => number | undefined) =>
        usageEvents.reduce((total, usage) => total + (pick(usage) ?? 0), 0);
    const inputTokens = sum((usage) => usage.inputTokens);
    const outputTokens = sum((usage) => usage.outputTokens);
    if (inputTokens + outputTokens === 0) {
        return undefined;
    }
    return {
        source: "assistant.usage",
        requestCount: usageEvents.length,
        usageComplete: true,
        models: [...new Set(usageEvents.map((usage) => usage.model))],
        inputTokens,
        cachedInputTokens: sum((usage) => usage.cacheReadTokens),
        cacheWriteTokens: sum((usage) => usage.cacheWriteTokens),
        outputTokens,
        reasoningOutputTokens: sum((usage) => usage.reasoningTokens),
        totalTokens: inputTokens + outputTokens,
    };
}

export function normalizeRpcUsage(value: unknown): CopilotUsage | undefined {
    const metrics = recordValue(value);
    const modelMetrics = recordValue(metrics?.modelMetrics);
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let cacheWriteTokens = 0;
    let outputTokens = 0;
    let reasoningOutputTokens = 0;
    let requestCount = 0;
    const models: string[] = [];
    for (const [model, rawMetric] of Object.entries(modelMetrics ?? {})) {
        const metric = recordValue(rawMetric);
        const usage = recordValue(metric?.usage);
        const requests = recordValue(metric?.requests);
        if (!usage) {
            continue;
        }
        models.push(model);
        requestCount += numberValue(requests?.count);
        inputTokens += numberValue(usage.inputTokens);
        cachedInputTokens += numberValue(usage.cacheReadTokens);
        cacheWriteTokens += numberValue(usage.cacheWriteTokens);
        outputTokens += numberValue(usage.outputTokens);
        reasoningOutputTokens += numberValue(usage.reasoningTokens);
    }
    if (models.length === 0) {
        const details = recordValue(metrics?.tokenDetails);
        inputTokens = tokenDetail(details, "input");
        outputTokens = tokenDetail(details, "output");
        cachedInputTokens = tokenDetail(details, "cache_read");
        cacheWriteTokens = tokenDetail(details, "cache_write");
        reasoningOutputTokens = tokenDetail(details, "reasoning");
        requestCount = numberValue(metrics?.totalUserRequests);
        const currentModel = stringValue(metrics?.currentModel);
        if (currentModel) {
            models.push(currentModel);
        }
    }
    if (inputTokens + outputTokens === 0) {
        return undefined;
    }
    return {
        source: "rpc",
        requestCount,
        usageComplete: true,
        models,
        inputTokens,
        cachedInputTokens,
        cacheWriteTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens: inputTokens + outputTokens,
    };
}

export function reconcileCopilotUsage(
    usageEvents: AssistantUsageData[],
    rpcMetrics: unknown,
): CopilotUsage {
    const authoritative = normalizeRpcUsage(rpcMetrics);
    if (!authoritative) {
        throw new Error("Authoritative RPC metrics are missing");
    }
    const live = summarizeCopilotUsage(usageEvents);
    if (live && !sameUsage(live, authoritative)) {
        throw new Error(
            "Live Copilot usage does not match authoritative RPC metrics",
        );
    }
    return live ?? authoritative;
}

function sameUsage(left: CopilotUsage, right: CopilotUsage): boolean {
    return (
        left.requestCount === right.requestCount &&
        JSON.stringify([...left.models].sort()) ===
            JSON.stringify([...right.models].sort()) &&
        left.inputTokens === right.inputTokens &&
        left.cachedInputTokens === right.cachedInputTokens &&
        left.cacheWriteTokens === right.cacheWriteTokens &&
        left.outputTokens === right.outputTokens &&
        left.reasoningOutputTokens === right.reasoningOutputTokens &&
        left.totalTokens === right.totalTokens
    );
}

export async function readExploreTelemetry(
    telemetryFile: string,
    expectedModel: string,
): Promise<ExploreTelemetry> {
    let value: unknown;
    try {
        value = JSON.parse(await readFile(telemetryFile, "utf8"));
    } catch (error) {
        throw new Error(
            `Unable to read TypeAgent telemetry ${telemetryFile}: ${(error as Error).message}`,
        );
    }
    const telemetry = recordValue(value);
    if (!telemetry) {
        throw new Error("TypeAgent telemetry must be a JSON object");
    }
    if (
        telemetry.schemaVersion !== 1 &&
        telemetry.schemaVersion !== 2 &&
        telemetry.schemaVersion !== 3 &&
        telemetry.schemaVersion !== 4
    ) {
        throw new Error(
            "TypeAgent telemetry schemaVersion must be 1, 2, 3, or 4",
        );
    }
    const schemaVersion = telemetry.schemaVersion;
    const model = requiredString(telemetry, "model", "telemetry");
    if (model !== expectedModel) {
        throw new Error(
            `TypeAgent telemetry model ${JSON.stringify(model)} does not match expected model ${JSON.stringify(expectedModel)}`,
        );
    }
    if (telemetry.schemaVersion === 1) {
        const invocation = parseExploreInvocation(telemetry, "telemetry", 0, 1);
        return {
            schemaVersion: 1,
            model,
            status: invocation.status,
            usage: invocation.usage,
            toolTrace: invocation.toolTrace,
            ...(invocation.result ? { result: invocation.result } : {}),
            ...(invocation.error ? { error: invocation.error } : {}),
        };
    }
    if (!Array.isArray(telemetry.invocations)) {
        throw new Error("telemetry.invocations must be an array");
    }
    if (telemetry.invocations.length === 0) {
        throw new Error("telemetry.invocations must not be empty");
    }
    const invocations = telemetry.invocations.map((value, index) => {
        const record = recordValue(value);
        if (!record) {
            throw new Error(
                `telemetry.invocations[${index}] must be an object`,
            );
        }
        const invocation = parseExploreInvocation(
            record,
            `telemetry.invocations[${index}]`,
            index,
            schemaVersion,
        );
        if (invocation.index !== index) {
            throw new Error(
                `telemetry.invocations[${index}].index must equal ${index}`,
            );
        }
        return invocation;
    });
    const usage = invocations.reduce<TypeAgentUsage>(
        (total, invocation) => ({
            requestCount: total.requestCount + invocation.usage.requestCount,
            usageComplete:
                total.usageComplete !== false &&
                invocation.usage.usageComplete !== false,
            inputTokens: total.inputTokens + invocation.usage.inputTokens,
            cachedInputTokens:
                total.cachedInputTokens + invocation.usage.cachedInputTokens,
            cacheWriteTokens:
                total.cacheWriteTokens + invocation.usage.cacheWriteTokens,
            outputTokens: total.outputTokens + invocation.usage.outputTokens,
            reasoningOutputTokens:
                total.reasoningOutputTokens +
                invocation.usage.reasoningOutputTokens,
            totalTokens: total.totalTokens + invocation.usage.totalTokens,
        }),
        {
            requestCount: 0,
            usageComplete: true,
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
        },
    );
    const calls = invocations.flatMap(
        (invocation) => invocation.toolTrace.calls,
    );
    const failures = invocations.filter(
        (invocation) => invocation.status === "failed",
    );
    return {
        schemaVersion,
        model,
        status: failures.length === 0 ? "completed" : "failed",
        usage,
        toolTrace: {
            calls,
            totalCalls: calls.length,
            totalOutputBytes: invocations.reduce(
                (total, invocation) =>
                    total + invocation.toolTrace.totalOutputBytes,
                0,
            ),
        },
        invocations,
        ...(invocations.length === 1 && invocations[0].result
            ? { result: invocations[0].result }
            : {}),
        ...(failures.length > 0
            ? {
                  error: failures
                      .map((invocation) => invocation.error)
                      .filter((error): error is string => Boolean(error))
                      .join("; ")
                      .slice(0, 2_000),
              }
            : {}),
    };
}

export async function readExploreTelemetryEventually(
    telemetryFile: string,
    expectedModel: string,
    waitMs: number,
    pollIntervalMs = TELEMETRY_POLL_INTERVAL_MS,
): Promise<ExploreTelemetry> {
    const deadline = Date.now() + Math.max(0, waitMs);
    while (waitMs > 0) {
        try {
            await access(telemetryFile, constants.R_OK);
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                break;
            }
            await delay(Math.min(Math.max(1, pollIntervalMs), remaining));
        }
    }
    return readExploreTelemetry(telemetryFile, expectedModel);
}

function parseExploreInvocation(
    telemetry: Record<string, unknown>,
    context: string,
    fallbackIndex: number,
    schemaVersion: 1 | 2 | 3 | 4,
): ExploreInvocationTelemetry {
    const status = telemetry.status;
    if (status !== "completed" && status !== "failed") {
        throw new Error(`${context}.status must be 'completed' or 'failed'`);
    }
    const allowZeroUsage = status === "failed";
    const usage = parseTypeAgentUsage(
        requiredRecord(telemetry, "usage", context),
        `${context}.usage`,
        allowZeroUsage,
    );
    const translationUsage =
        schemaVersion === 3
            ? parseTypeAgentUsage(
                  requiredRecord(telemetry, "translationUsage", context),
                  `${context}.translationUsage`,
                  true,
              )
            : undefined;
    const codeModeUsage =
        schemaVersion === 3
            ? parseTypeAgentUsage(
                  requiredRecord(telemetry, "codeModeUsage", context),
                  `${context}.codeModeUsage`,
                  allowZeroUsage,
              )
            : undefined;
    const actionTranslationAndCodeGenerationUsage =
        schemaVersion === 4
            ? parseTypeAgentUsage(
                  requiredRecord(
                      telemetry,
                      "actionTranslationAndCodeGenerationUsage",
                      context,
                  ),
                  `${context}.actionTranslationAndCodeGenerationUsage`,
                  allowZeroUsage,
              )
            : undefined;
    if (
        translationUsage &&
        codeModeUsage &&
        !usageEquals(usage, addTypeAgentUsage(translationUsage, codeModeUsage))
    ) {
        throw new Error(
            `${context}.usage must equal translationUsage plus codeModeUsage`,
        );
    }
    if (
        actionTranslationAndCodeGenerationUsage &&
        !usageEquals(usage, actionTranslationAndCodeGenerationUsage)
    ) {
        throw new Error(
            `${context}.usage must equal actionTranslationAndCodeGenerationUsage`,
        );
    }
    const toolTraceValue = requiredRecord(telemetry, "toolTrace", context);
    const toolTraceContext = `${context}.toolTrace`;
    if (!Array.isArray(toolTraceValue.calls)) {
        throw new Error(`${toolTraceContext}.calls must be an array`);
    }
    const calls = toolTraceValue.calls.map((call, index) => {
        const callContext = `${toolTraceContext}.calls[${index}]`;
        const record = recordValue(call);
        if (!record) {
            throw new Error(`${callContext} must be an object`);
        }
        return parseTypeAgentToolCall(record, callContext);
    });
    const totalCalls = requiredNonNegativeNumber(
        toolTraceValue,
        "totalCalls",
        toolTraceContext,
    );
    if (totalCalls !== calls.length) {
        throw new Error(
            `${toolTraceContext}.totalCalls must equal calls.length`,
        );
    }
    const resultValue = recordValue(telemetry.result);
    const result = resultValue
        ? {
              citationCount: requiredNonNegativeNumber(
                  resultValue,
                  "citationCount",
                  `${context}.result`,
              ),
              truncated: requiredBoolean(
                  resultValue,
                  "truncated",
                  `${context}.result`,
              ),
          }
        : undefined;
    const error =
        typeof telemetry.error === "string" ? telemetry.error : undefined;
    const reasoningTrace =
        schemaVersion === 4 && telemetry.reasoningTrace !== undefined
            ? parseReasoningTrace(telemetry.reasoningTrace, context)
            : undefined;
    const actionAttempts =
        schemaVersion === 4 && telemetry.actionAttempts !== undefined
            ? parseActionAttempts(telemetry.actionAttempts, context)
            : undefined;
    const hasStartedAt = telemetry.startedAt !== undefined;
    const hasDurationMs = telemetry.durationMs !== undefined;
    if (hasStartedAt !== hasDurationMs) {
        throw new Error(
            `${context}.startedAt and ${context}.durationMs must be present together`,
        );
    }
    const startedAt = hasStartedAt
        ? requiredString(telemetry, "startedAt", context)
        : undefined;
    if (startedAt) {
        const timestamp = Date.parse(startedAt);
        if (
            Number.isNaN(timestamp) ||
            new Date(timestamp).toISOString() !== startedAt
        ) {
            throw new Error(`${context}.startedAt must be an ISO timestamp`);
        }
    }
    const durationMs = hasDurationMs
        ? requiredNonNegativeNumber(telemetry, "durationMs", context)
        : undefined;
    const querySha256 =
        schemaVersion === 4
            ? requiredString(telemetry, "querySha256", context)
            : undefined;
    if (querySha256 && !/^[a-f0-9]{64}$/.test(querySha256)) {
        throw new Error(
            `${context}.querySha256 must be a lowercase SHA-256 digest`,
        );
    }
    return {
        index:
            telemetry.index === undefined
                ? fallbackIndex
                : requiredNonNegativeNumber(telemetry, "index", context),
        status,
        ...(startedAt ? { startedAt } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(querySha256 ? { querySha256 } : {}),
        usage,
        ...(translationUsage ? { translationUsage } : {}),
        ...(codeModeUsage ? { codeModeUsage } : {}),
        ...(actionTranslationAndCodeGenerationUsage
            ? { actionTranslationAndCodeGenerationUsage }
            : {}),
        toolTrace: {
            calls,
            totalCalls,
            totalOutputBytes: requiredNonNegativeNumber(
                toolTraceValue,
                "totalOutputBytes",
                toolTraceContext,
            ),
        },
        ...(reasoningTrace ? { reasoningTrace } : {}),
        ...(actionAttempts ? { actionAttempts } : {}),
        ...(result ? { result } : {}),
        ...(error ? { error } : {}),
    };
}

function parseReasoningTrace(
    value: unknown,
    context: string,
): NonNullable<ExploreInvocationTelemetry["reasoningTrace"]> {
    if (!Array.isArray(value)) {
        throw new Error(`${context}.reasoningTrace must be an array`);
    }
    return value.map((item, index) => {
        const itemContext = `${context}.reasoningTrace[${index}]`;
        const record = recordValue(item);
        if (!record) {
            throw new Error(`${itemContext} must be an object`);
        }
        const status = requiredAttemptStatus(record, itemContext);
        const actionName = optionalString(record.actionName);
        const error = optionalString(record.error);
        return {
            index: requiredNonNegativeNumber(record, "index", itemContext),
            tool: requiredString(record, "tool", itemContext),
            status,
            ...(actionName ? { actionName } : {}),
            ...(error ? { error } : {}),
        };
    });
}

function parseActionAttempts(
    value: unknown,
    context: string,
): NonNullable<ExploreInvocationTelemetry["actionAttempts"]> {
    if (!Array.isArray(value)) {
        throw new Error(`${context}.actionAttempts must be an array`);
    }
    return value.map((item, index) => {
        const itemContext = `${context}.actionAttempts[${index}]`;
        const record = recordValue(item);
        if (!record) {
            throw new Error(`${itemContext} must be an object`);
        }
        const error = optionalString(record.error);
        return {
            index: requiredNonNegativeNumber(record, "index", itemContext),
            actionName: requiredString(record, "actionName", itemContext),
            status: requiredAttemptStatus(record, itemContext),
            ...(error ? { error } : {}),
        };
    });
}

function requiredAttemptStatus(
    value: Record<string, unknown>,
    context: string,
): "completed" | "failed" {
    if (value.status !== "completed" && value.status !== "failed") {
        throw new Error(`${context}.status must be 'completed' or 'failed'`);
    }
    return value.status;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function parseTypeAgentUsage(
    usageValue: Record<string, unknown>,
    usageContext: string,
    allowZero = false,
): TypeAgentUsage {
    const usage: TypeAgentUsage = {
        requestCount: requiredNonNegativeNumber(
            usageValue,
            "requestCount",
            usageContext,
            !allowZero,
        ),
        usageComplete:
            usageValue.usageComplete === undefined
                ? true
                : requiredBoolean(usageValue, "usageComplete", usageContext),
        inputTokens: requiredNonNegativeNumber(
            usageValue,
            "inputTokens",
            usageContext,
        ),
        cachedInputTokens: optionalNonNegativeNumber(
            usageValue,
            "cachedInputTokens",
            usageContext,
        ),
        cacheWriteTokens: 0,
        outputTokens: requiredNonNegativeNumber(
            usageValue,
            "outputTokens",
            usageContext,
        ),
        reasoningOutputTokens: optionalNonNegativeNumber(
            usageValue,
            "reasoningOutputTokens",
            usageContext,
        ),
        totalTokens: requiredNonNegativeNumber(
            usageValue,
            "totalTokens",
            usageContext,
            !allowZero,
        ),
    };
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
        throw new Error(
            `${usageContext}.totalTokens must equal inputTokens plus outputTokens`,
        );
    }
    if (
        usage.requestCount === 0 &&
        (usage.inputTokens !== 0 ||
            usage.outputTokens !== 0 ||
            usage.totalTokens !== 0)
    ) {
        throw new Error(
            `${usageContext} with zero requests must have zero tokens`,
        );
    }
    return usage;
}

function addTypeAgentUsage(
    first: TypeAgentUsage,
    second: TypeAgentUsage,
): TypeAgentUsage {
    return {
        requestCount: first.requestCount + second.requestCount,
        usageComplete:
            first.usageComplete !== false && second.usageComplete !== false,
        inputTokens: first.inputTokens + second.inputTokens,
        cachedInputTokens: first.cachedInputTokens + second.cachedInputTokens,
        cacheWriteTokens: first.cacheWriteTokens + second.cacheWriteTokens,
        outputTokens: first.outputTokens + second.outputTokens,
        reasoningOutputTokens:
            first.reasoningOutputTokens + second.reasoningOutputTokens,
        totalTokens: first.totalTokens + second.totalTokens,
    };
}

function usageEquals(first: TypeAgentUsage, second: TypeAgentUsage): boolean {
    return (
        first.requestCount === second.requestCount &&
        (first.usageComplete !== false) === (second.usageComplete !== false) &&
        first.inputTokens === second.inputTokens &&
        first.cachedInputTokens === second.cachedInputTokens &&
        first.cacheWriteTokens === second.cacheWriteTokens &&
        first.outputTokens === second.outputTokens &&
        first.reasoningOutputTokens === second.reasoningOutputTokens &&
        first.totalTokens === second.totalTokens
    );
}

function parseTypeAgentToolCall(
    record: Record<string, unknown>,
    context: string,
): ExploreInvocationTelemetry["toolTrace"]["calls"][number] {
    const tool = requiredString(record, "tool", context);
    if (!new Set(["ls", "glob", "grep", "read", "lsp"]).has(tool)) {
        throw new Error(`${context}.tool is not a repository exploration tool`);
    }
    return {
        tool,
        ...(typeof record.startedAt === "string"
            ? { startedAt: record.startedAt }
            : {}),
        durationMs: requiredNonNegativeNumber(record, "durationMs", context),
        input: record.input,
        resultCount: requiredNonNegativeNumber(record, "resultCount", context),
        outputBytes: requiredNonNegativeNumber(record, "outputBytes", context),
        truncated: requiredBoolean(record, "truncated", context),
        ...(typeof record.error === "string" ? { error: record.error } : {}),
        ...(record.discarded === true ? { discarded: true } : {}),
    };
}

export function addUsage(outer: TokenUsage, inner: TypeAgentUsage): TokenUsage {
    return {
        inputTokens: outer.inputTokens + inner.inputTokens,
        cachedInputTokens: outer.cachedInputTokens + inner.cachedInputTokens,
        cacheWriteTokens: outer.cacheWriteTokens + inner.cacheWriteTokens,
        outputTokens: outer.outputTokens + inner.outputTokens,
        reasoningOutputTokens:
            outer.reasoningOutputTokens + inner.reasoningOutputTokens,
        totalTokens: outer.totalTokens + inner.totalTokens,
    };
}

async function waitForMcpServer(
    session: Awaited<ReturnType<CopilotClient["createSession"]>>,
    serverName: string,
    timeoutMs: number,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = "not configured";
    do {
        const state = await session.rpc.mcp.list();
        const server = state.servers.find(
            (candidate) => candidate.name === serverName,
        );
        lastStatus = server?.status ?? "not configured";
        const failure =
            server?.error ?? state.host?.failedServers[serverName]?.message;
        if (failure) {
            throw new Error(`TypeAgent MCP failed to connect: ${failure}`);
        }
        if (lastStatus === "connected") {
            const running = await session.rpc.mcp.isServerRunning({
                serverName,
            });
            if (running.running) {
                return;
            }
        }
        await delay(100);
    } while (Date.now() < deadline);
    throw new Error(
        `TypeAgent MCP did not reach running state within ${timeoutMs}ms; last status=${lastStatus}`,
    );
}

async function readSessionUsage(
    session: Awaited<ReturnType<CopilotClient["createSession"]>>,
    usageEvents: AssistantUsageData[],
): Promise<CopilotUsage | undefined> {
    let metrics: unknown;
    try {
        metrics = await session.rpc.usage.getMetrics();
    } catch {
        return undefined;
    }
    return reconcileCopilotUsage(usageEvents, metrics);
}

function permissionHandler(variant: BenchmarkVariant): PermissionHandler {
    return (request) => {
        if (
            isTypeAgentVariant(variant) &&
            request.kind === "mcp" &&
            request.serverName === "typeagent" &&
            request.toolName === "explore"
        ) {
            return { kind: "approve-once" };
        }
        if (
            variant === "baseline" &&
            request.kind === "custom-tool" &&
            new Set(["read", "grep", "glob", "bash"]).has(request.toolName)
        ) {
            return { kind: "approve-once" };
        }
        return {
            kind: "reject",
            feedback:
                "This read-only benchmark permits only its selected repository exploration tools.",
        };
    };
}

function recordEvent(
    events: CopilotTraceItem[],
    usageEvents: AssistantUsageData[],
    event: SessionEvent,
    runStartedMs: number,
): void {
    if (event.type === "assistant.usage") {
        usageEvents.push(event.data);
    }
    if (
        event.type === "assistant.message" ||
        event.type === "assistant.message_delta" ||
        event.type === "assistant.streaming_delta" ||
        event.type === "assistant.usage" ||
        event.type === "tool.execution_start" ||
        event.type === "tool.execution_complete" ||
        event.type === "subagent.started" ||
        event.type === "subagent.completed" ||
        event.type === "subagent.failed" ||
        event.type === "abort" ||
        event.type === "session.idle" ||
        event.type === "session.mcp_servers_loaded" ||
        event.type === "session.error"
    ) {
        events.push({
            ...(compactValue(event) as CopilotTraceItem),
            observedAtOffsetMs: Math.max(0, Date.now() - runStartedMs),
        });
    }
}

async function resolveEnvironment(
    apiKeyEnv: string,
    envFile?: string,
): Promise<Record<string, string>> {
    const environment: Record<string, string> = Object.fromEntries(
        Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
        ),
    );
    if (!environment[apiKeyEnv]) {
        const result = spawnSync("launchctl", ["getenv", apiKeyEnv], {
            encoding: "utf8",
        });
        const value = result.status === 0 ? result.stdout.trim() : "";
        if (value) {
            environment[apiKeyEnv] = value;
        }
    }
    if (envFile) {
        Object.assign(environment, await readEnvFile(envFile));
    }
    if (!environment[apiKeyEnv]) {
        throw new Error(
            `Missing ${apiKeyEnv}. Set it in the environment, launchctl, or --env-file.`,
        );
    }
    return environment;
}

function resolvePlatformCopilotPackage(): string | undefined {
    try {
        const localRequire = createRequire(import.meta.url);
        const copilotRequire = createRequire(
            localRequire.resolve("@github/copilot/package.json"),
        );
        const platformTags =
            process.platform === "linux"
                ? (
                      copilotRequire("detect-libc") as {
                          isNonGlibcLinuxSync(): boolean;
                      }
                  ).isNonGlibcLinuxSync()
                    ? ["linuxmusl", "linux"]
                    : ["linux"]
                : [process.platform];
        for (const platformTag of platformTags) {
            try {
                return copilotRequire.resolve(
                    `@github/copilot-${platformTag}-${process.arch}`,
                );
            } catch {
                // Try the next platform package supported by the official loader.
            }
        }
    } catch {
        // The package is not installed in this dependency graph.
    }
    return undefined;
}

function findOnPath(command: string): string | undefined {
    const result = spawnSync("which", [command], { encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : undefined;
}

function safeRuntimeEnvironment(): NodeJS.ProcessEnv {
    const pathValue = [path.dirname(process.execPath), process.env.PATH]
        .filter(Boolean)
        .join(path.delimiter);
    return {
        PATH: pathValue,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        TERM: process.env.TERM,
    };
}

async function abortQuietly(
    session: Awaited<ReturnType<CopilotClient["createSession"]>>,
): Promise<void> {
    try {
        await withTimeout(session.abort(), 5_000, "Copilot abort timed out");
    } catch {
        // The original run error remains more useful.
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

function compactValue(value: unknown, depth = 0): unknown {
    if (depth > 5) {
        return "[truncated]";
    }
    if (typeof value === "string") {
        return value.length > 12_000
            ? `${value.slice(0, 12_000)}\n[truncated]`
            : value;
    }
    if (Array.isArray(value)) {
        return value.slice(0, 50).map((item) => compactValue(item, depth + 1));
    }
    const record = recordValue(value);
    if (!record) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(record)
            .slice(0, 100)
            .map(([key, item]) => [key, compactValue(item, depth + 1)]),
    );
}

function tokenDetail(
    details: Record<string, unknown> | undefined,
    key: string,
): number {
    return numberValue(recordValue(details?.[key])?.tokenCount);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nonNegativeInteger(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value >= 0
        ? value
        : undefined;
}

function requiredRecord(
    value: Record<string, unknown>,
    key: string,
    parent: string,
): Record<string, unknown> {
    const result = recordValue(value[key]);
    if (!result) {
        throw new Error(`${parent}.${key} must be an object`);
    }
    return result;
}

function requiredString(
    value: Record<string, unknown>,
    key: string,
    parent: string,
): string {
    const result = value[key];
    if (typeof result !== "string" || !result) {
        throw new Error(`${parent}.${key} must be a non-empty string`);
    }
    return result;
}

function requiredBoolean(
    value: Record<string, unknown>,
    key: string,
    parent: string,
): boolean {
    const result = value[key];
    if (typeof result !== "boolean") {
        throw new Error(`${parent}.${key} must be a boolean`);
    }
    return result;
}

function requiredNonNegativeNumber(
    value: Record<string, unknown>,
    key: string,
    parent: string,
    positive = false,
): number {
    const result = value[key];
    if (
        typeof result !== "number" ||
        !Number.isFinite(result) ||
        !Number.isInteger(result) ||
        result < (positive ? 1 : 0)
    ) {
        throw new Error(
            `${parent}.${key} must be a ${positive ? "positive" : "non-negative"} integer`,
        );
    }
    return result;
}

function optionalNonNegativeNumber(
    value: Record<string, unknown>,
    key: string,
    parent: string,
): number {
    return value[key] === undefined
        ? 0
        : requiredNonNegativeNumber(value, key, parent);
}
