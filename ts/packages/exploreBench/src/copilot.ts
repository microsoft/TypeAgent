// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CopilotClient,
    RuntimeConnection,
    ToolSet,
    type AssistantUsageData,
    type CustomAgentConfig,
    type PermissionHandler,
    type SessionEvent,
} from "@github/copilot-sdk";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createCopilotExplorationTools } from "./copilotTools.js";
import { readEnvFile, redact } from "./io.js";
import { parseFinalAnswer } from "./score.js";
import type {
    BenchmarkAgentConfig,
    CopilotToolCallTrace,
    CopilotTraceItem,
    CopilotUsage,
    ExploreTelemetry,
    ExplorerSubagentTrace,
    McpToolCallTrace,
    TokenUsage,
    TypeAgentUsage,
} from "./types.js";
import { BENCHMARK_TOOL_CALL_LIMIT } from "./types.js";

// Copilot uses modelId only for its built-in agent behavior, tool, and token
// limit profile. wireModel below is the exact Luna/Terra/Sol route sent to
// LiteLLM for inference.
const COPILOT_BEHAVIOR_MODEL_ID = "gpt-5";

export const COPILOT_SDK_VERSION = "1.0.4";

const benchmarkOutputContract = `Use static inspection only from the current repository root. Do not scan outside the repository. Do not edit files, install dependencies, run tests, run project code, or write patches.
Your final response MUST be only this XML block, with no markdown and no prose outside it:
<final_answer>
path/to/file.ext:10-20
path/to/other.ext:5
</final_answer>
Return at most six repository-relative file paths with exact line or line ranges most likely needing changes.
If evidence is weak, still output the closest file:line locations inside the block.`;

export function buildBenchmarkSystemMessage(): string {
    const requiredPath = `You are the default main agent in an evaluation benchmark.
Your first assistant action MUST delegate to the \`explorer\` subagent with the \`task\` tool, and you must complete exactly one successful delegation. Provide every required task argument: \`description\`, \`prompt\`, \`agent_type: "explorer"\`, \`name\`, and \`mode: "sync"\`. If the task schema is rejected before the subagent starts, correct it and retry. Do not request another tool or include prose in the first action. Pass the complete query and problem statement to the subagent, including reproduction details, exact identifiers, errors, and historical line references.
Wait for the explorer subagent to finish. Do not inspect the repository yourself. Then return only the explorer's repository locations in the required output format.`;
    return `${requiredPath}\n${benchmarkOutputContract}`;
}

export function buildBenchmarkPrompt(query: string): string {
    const instruction = "Use the explorer subagent.";
    return `${instruction}\n\n<query>\n${query}\n</query>\n\nRemember: final response only, exactly <final_answer> path:line locations </final_answer>. Do not include analysis prose outside the block.`;
}

export interface CopilotHarnessOptions {
    copilotPath: string;
    baseDirectory: string;
    workingDirectory: string;
}

export interface CopilotRunOptions {
    repoPath: string;
    prompt: string;
    model: string;
    variant: "baseline";
    providerBaseUrl: string;
    apiKeyEnv: string;
    agent: BenchmarkAgentConfig;
    envFile?: string;
    telemetryFile: string;
    timeoutMs: number;
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
    finalAnswer: string;
    usage?: CopilotUsage;
    typeAgentUsage?: TypeAgentUsage;
    combinedUsage?: TokenUsage;
    exploreTelemetry?: ExploreTelemetry;
    telemetryFile: string;
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
    firstAssistantActionExclusiveExplorer: boolean;
    explorerCompletedBeforeLaterAssistantAction: boolean;
    mainAgentRepositoryInspection: boolean;
    explorerSubagentTrace: ExplorerSubagentTrace[];
    selectedAgentName?: string;
    error?: string;
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
    if (options.variant !== "baseline") {
        throw new Error("Copilot runner supports only the baseline arm");
    }
    const started = Date.now();
    const events: CopilotTraceItem[] = [];
    const usageEvents: AssistantUsageData[] = [];
    const toolTrace: CopilotToolCallTrace[] = [];
    let finalAnswer = "";
    let caughtError: string | undefined;
    let usage: CopilotUsage | undefined;
    let completionUsageComplete = true;
    let usedRepair = false;
    let selectedAgentName: string | undefined;
    let defaultMainAgent = false;
    let session:
        | Awaited<ReturnType<CopilotClient["createSession"]>>
        | undefined;
    let secret = "";

    try {
        const environment = await resolveEnvironment(
            options.apiKeyEnv,
            options.envFile,
        );
        secret = environment[options.apiKeyEnv] ?? "";
        const tools = await createCopilotExplorationTools(
            options.repoPath,
            toolTrace,
            BENCHMARK_TOOL_CALL_LIMIT,
        );
        const routing = buildAgentRoutingConfig(options.agent);

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
            tools,
            ...routing,
            customAgentsLocalOnly: true,
            onPermissionRequest: permissionHandler(),
            onEvent: (event) => recordEvent(events, usageEvents, event),
            systemMessage: {
                mode: "replace",
                content: buildBenchmarkSystemMessage(),
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

        const selectedAgent = await session.rpc.agent.getCurrent();
        selectedAgentName = selectedAgent.agent?.name;
        defaultMainAgent = selectedAgent.agent === null;
        if (!defaultMainAgent) {
            throw new Error(
                `Copilot selected custom agent ${JSON.stringify(selectedAgentName)} instead of retaining the default main agent`,
            );
        }

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

        const prompt = buildBenchmarkPrompt(options.prompt);
        try {
            const reply = await session.sendAndWait(
                { prompt },
                options.timeoutMs,
            );
            finalAnswer = reply?.data.content ?? "";
            if (shouldRepairFinalAnswer(finalAnswer, options.repoPath)) {
                const repaired = await session.sendAndWait(
                    {
                        prompt: `Your previous answer did not use the required machine-readable localization format. Convert it now using only evidence already gathered. Do not call any tool. Return ONLY:\n<final_answer>\npath/to/file.py:line-or-start-end\n</final_answer>\nNo markdown, no bullets, no code blocks, no prose outside the XML block.`,
                    },
                    options.timeoutMs,
                );
                finalAnswer = repaired?.data.content ?? finalAnswer;
                usedRepair = true;
            }
        } catch (error) {
            completionUsageComplete = false;
            await abortQuietly(session);
            throw error;
        }
        usage = await readSessionUsage(session, usageEvents);
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
            usage = await readSessionUsage(session, usageEvents);
        }
        if (usage && !completionUsageComplete) {
            usage = { ...usage, usageComplete: false };
        }
    } finally {
        if (session) {
            try {
                await withTimeout(
                    session.disconnect(),
                    10_000,
                    "Copilot session disconnect timed out",
                );
            } catch (error) {
                caughtError ??= redact((error as Error).message, [secret]);
            }
        }
    }

    const inspection = inspectCopilotToolTrace(events);
    const treatmentError = treatmentValidationError(inspection);
    const error = [caughtError, treatmentError].filter(Boolean).join("\n");
    const combinedUsage = usage?.usageComplete !== false ? usage : undefined;
    const ok = Boolean(finalAnswer) && !error;

    return {
        ok,
        durationMs: Date.now() - started,
        finalAnswer,
        ...(usage ? { usage } : {}),
        ...(combinedUsage ? { combinedUsage } : {}),
        telemetryFile: options.telemetryFile,
        attemptedExploreCalls: inspection.attemptedExploreCalls,
        completedExploreCalls: inspection.completedExploreCalls,
        successfulExploreCalls: inspection.successfulExploreCalls,
        outsideExploreInspection: inspection.outsideExploreInspection,
        mcpServerReady: false,
        mcpAdvertisedTools: [],
        mcpAdopted: inspection.attemptedExploreCalls > 0,
        lspAdopted: false,
        lspCallCount: 0,
        lspResultCount: 0,
        usedRepair,
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
    agent: BenchmarkAgentConfig,
): AgentRoutingConfig {
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

export function inspectCopilotToolTrace(
    events: CopilotTraceItem[],
): CopilotToolInspection {
    const mcpStarts: Array<{
        toolCallId: string;
        server?: string;
        tool?: string;
        arguments?: unknown;
    }> = [];
    const taskStarts: Array<{
        toolCallId: string;
        arguments?: unknown;
    }> = [];
    const completions = new Map<
        string,
        { success: boolean; result?: unknown; error?: string }
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
                mcpStarts.push({
                    toolCallId,
                    server,
                    tool,
                    arguments: data?.arguments,
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
            completions.set(toolCallId, {
                success: data?.success === true,
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
    inspection: CopilotToolInspection,
): string | undefined {
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
        request.mcpToolName === "explore";
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

async function readSessionUsage(
    session: Awaited<ReturnType<CopilotClient["createSession"]>>,
    usageEvents: AssistantUsageData[],
): Promise<CopilotUsage | undefined> {
    const live = summarizeCopilotUsage(usageEvents);
    if (live) {
        return live;
    }
    try {
        return normalizeRpcUsage(await session.rpc.usage.getMetrics());
    } catch {
        return undefined;
    }
}

function permissionHandler(): PermissionHandler {
    return (request) => {
        if (
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
): void {
    if (event.type === "assistant.usage") {
        usageEvents.push(event.data);
    }
    if (
        event.type === "assistant.message" ||
        event.type === "assistant.usage" ||
        event.type === "tool.execution_start" ||
        event.type === "tool.execution_complete" ||
        event.type === "subagent.started" ||
        event.type === "subagent.completed" ||
        event.type === "subagent.failed" ||
        event.type === "session.mcp_servers_loaded" ||
        event.type === "session.error"
    ) {
        events.push(compactValue(event) as CopilotTraceItem);
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
