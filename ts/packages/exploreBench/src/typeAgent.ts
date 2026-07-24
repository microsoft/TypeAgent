// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionResult,
    AppAgent,
    AppAgentManifest,
    DisplayContent,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";
import { configFromEnvRecord, setRuntimeConfig } from "@typeagent/aiclient";
import {
    awaitCommand,
    createDispatcher,
    type AppAgentProvider,
    type ClientIO,
    type CompletionUsageStats,
    type IAgentMessage,
    type RequestId,
} from "agent-dispatcher";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    createCodeModeExplorer,
    createDefaultLanguageServers,
    createTypeAgentReasoningAdapter,
    defaultTypeScriptLanguageServerCommand,
    type ExploreUsage,
    type RepositoryExploreResult,
    type RepositoryExplorer,
    type LanguageServerOptions,
} from "explorer-typeagent";
import { readExploreTelemetry } from "./exploreTelemetry.js";
import { readEnvFile } from "./io.js";
import { translatedRequestMatchesIngress } from "./requestIdentity.js";
import type {
    ExploreTelemetry,
    TokenUsage,
    TypeAgentDispatchEvidence,
    TypeAgentUsage,
} from "./types.js";

export const TYPEAGENT_EXPLORER_AGENT = "explorer";
export const TYPEAGENT_EXPLORER_ACTION = "exploreRepository";

const explorerRequestSchema = `export type ExplorerRequestActions = {
    actionName: "exploreRepository";
    parameters: {
        // Copy the complete user request byte-for-byte without summarizing it.
        request: string;
    };
};`;

const explorerManifest: AppAgentManifest = {
    emojiChar: "🔎",
    description: "Read-only repository exploration",
    defaultEnabled: true,
    schema: {
        description:
            "Explore a repository for the exact implementation locations requested by the user.",
        schemaType: "ExplorerRequestActions",
        schemaFile: { format: "ts", content: explorerRequestSchema },
        cached: false,
    },
};

export interface ExplorerExecution {
    action: TypeAgentAction;
    request: string;
    result: RepositoryExploreResult;
    actionResult: ActionResult;
}

export interface TypeAgentRunOptions {
    repoPath: string;
    ripgrepPath: string;
    prompt: string;
    model: string;
    variant: "typeagent" | "typeagent-lsp";
    providerBaseUrl: string;
    apiKeyEnv: string;
    envFile?: string;
    telemetryFile: string;
}

export interface TypeAgentRunOutput {
    ok: boolean;
    durationMs: number;
    finalAnswer: string;
    dispatcherUsage?: TypeAgentUsage;
    typeAgentUsage?: TypeAgentUsage;
    combinedUsage?: TokenUsage;
    exploreTelemetry?: ExploreTelemetry;
    telemetryFile: string;
    dispatchEvidence?: TypeAgentDispatchEvidence;
    lspAdopted: boolean;
    lspCallCount: number;
    lspResultCount: number;
    error?: string;
}

const BUILTIN_AGENT_NAMES = new Set(["dispatcher", "system"]);
const REASONING_REQUEST_TIMEOUT_MS = 120_000;
const packagesRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
);
let configuredRuntime: string | undefined;

export async function runTypeAgentDispatcher(
    options: TypeAgentRunOptions,
): Promise<TypeAgentRunOutput> {
    const started = Date.now();
    let dispatcher: Awaited<ReturnType<typeof createDispatcher>> | undefined;
    let explorer: RepositoryExplorer | undefined;
    let finalAnswer = "";
    let dispatcherUsage: TypeAgentUsage | undefined;
    let typeAgentUsage: TypeAgentUsage | undefined;
    let combinedUsage: TokenUsage | undefined;
    let exploreTelemetry: ExploreTelemetry | undefined;
    let dispatchEvidence: TypeAgentDispatchEvidence | undefined;
    let caughtError: string | undefined;
    const executions: ExplorerExecution[] = [];

    try {
        const apiKey = await configureTypeAgentRuntime(options);
        const reasoningAdapter = createTypeAgentReasoningAdapter({
            baseUrl: options.providerBaseUrl,
            apiKey,
            requestTimeoutMs: REASONING_REQUEST_TIMEOUT_MS,
        });
        const lsp =
            options.variant === "typeagent-lsp"
                ? createBenchmarkLanguageServerOptions()
                : undefined;
        explorer = createCodeModeExplorer({
            repoRoot: options.repoPath,
            ripgrepPath: options.ripgrepPath,
            reasoningAdapter,
            modelName: options.model,
            maxToolCalls: 8,
            telemetryFile: options.telemetryFile,
            ...(lsp ? { lsp } : {}),
        });
        const provider = createTypeAgentExplorerProvider(
            explorer,
            (execution) => executions.push(execution),
        );
        const messages = new Map<string, IAgentMessage[]>();
        dispatcher = await createDispatcher("typeagent-explore-benchmark", {
            appAgentProviders: [provider],
            agents: {
                schemas: [TYPEAGENT_EXPLORER_AGENT],
                actions: [TYPEAGENT_EXPLORER_AGENT],
                commands: ["dispatcher"],
            },
            translation: {
                enabled: true,
                model: options.model,
                stream: false,
                switch: {
                    fixed: TYPEAGENT_EXPLORER_AGENT,
                    embedding: false,
                    inline: false,
                    search: false,
                },
                multiple: { enabled: false },
                history: { enabled: false },
            },
            execution: { reasoning: "none" },
            explainer: { enabled: false },
            cache: { enabled: false },
            enableActionSchemaSemanticMap: false,
            clientIO: createClientIO(messages),
            collectCommandResult: true,
            metrics: true,
            dblogging: false,
            conversationMemorySettings: {
                requestKnowledgeExtraction: false,
                actionResultEntityStorage: false,
                actionResultKnowledgeExtraction: false,
            },
        });
        const status = await dispatcher.getStatus();
        const schemas = await dispatcher.getAgentSchemas();
        const requestId = randomUUID();
        messages.set(requestId, []);
        const commandResult = await awaitCommand(
            dispatcher,
            options.prompt,
            undefined,
            { noReasoning: true },
            undefined,
            requestId,
        );
        if (!commandResult || commandResult.lastError) {
            throw new Error(
                commandResult?.lastError ??
                    "TypeAgent dispatcher returned no command result",
            );
        }
        if (executions.length !== 1) {
            throw new Error(
                `TypeAgent executed Explorer ${executions.length} times`,
            );
        }
        finalAnswer = serializeBenchmarkFinalAnswer(executions[0].result.text);
        dispatcherUsage = normalizeDispatcherUsage(commandResult.tokenUsage);
        typeAgentUsage = normalizeExplorerUsage(executions[0].result.usage);
        requireActionUsage(commandResult.actionTokenUsage, typeAgentUsage);
        combinedUsage = combineTypeAgentUsage(dispatcherUsage, typeAgentUsage);
        exploreTelemetry = await readExploreTelemetry(
            options.telemetryFile,
            options.model,
        );
        requireUsageEqual(exploreTelemetry.usage, typeAgentUsage);
        dispatchEvidence = {
            ingress: "natural-language",
            submittedRequest: options.prompt,
            translationInvoked: dispatcherUsage.requestCount > 0,
            translationRequestCount: dispatcherUsage.requestCount,
            activeAgentNames: status.agents
                .filter(
                    (agent) => agent.active && !isBuiltinAgentName(agent.name),
                )
                .map((agent) => agent.name)
                .sort(),
            activeSchemaNames: schemas
                .flatMap((agent) => agent.subSchemas)
                .map((schema) => schema.schemaName)
                .filter((schemaName) => !isBuiltinAgentName(schemaName))
                .sort(),
            translatedActions: (commandResult.actions ?? []).map((action) => ({
                schemaName: action.schemaName,
                actionName: action.actionName,
                ...(action.parameters ? { parameters: action.parameters } : {}),
            })),
            executionCount: executions.length,
            outputMatchedExecution:
                finalAnswer ===
                    serializeBenchmarkFinalAnswer(executions[0].result.text) &&
                displayContentToText(
                    executions[0].actionResult.error === undefined
                        ? executions[0].actionResult.displayContent
                        : undefined,
                ) === finalAnswer,
            executionRequestMatchedIngress: translatedRequestMatchesIngress(
                executions[0].request,
                options.prompt,
            ),
            usedCopilot: false,
            usedMcp: false,
        };
        assertDirectDispatchEvidence(dispatchEvidence, options.prompt);
    } catch (error) {
        caughtError = error instanceof Error ? error.message : String(error);
    } finally {
        if (dispatcher) {
            try {
                await dispatcher.close();
            } catch (error) {
                caughtError ??=
                    error instanceof Error ? error.message : String(error);
            }
        }
        if (explorer?.close) {
            try {
                await explorer.close();
            } catch (error) {
                caughtError ??=
                    error instanceof Error ? error.message : String(error);
            }
        }
    }

    const lspCalls =
        exploreTelemetry?.toolTrace.calls.filter(
            (call) => call.tool === "lsp",
        ) ?? [];
    return {
        ok: caughtError === undefined,
        durationMs: Date.now() - started,
        finalAnswer,
        ...(dispatcherUsage ? { dispatcherUsage } : {}),
        ...(typeAgentUsage ? { typeAgentUsage } : {}),
        ...(combinedUsage ? { combinedUsage } : {}),
        ...(exploreTelemetry ? { exploreTelemetry } : {}),
        telemetryFile: options.telemetryFile,
        ...(dispatchEvidence ? { dispatchEvidence } : {}),
        lspAdopted: lspCalls.some(
            (call) => call.error === undefined && call.resultCount > 0,
        ),
        lspCallCount: lspCalls.length,
        lspResultCount: lspCalls.reduce(
            (total, call) => total + call.resultCount,
            0,
        ),
        ...(caughtError ? { error: caughtError } : {}),
    };
}

export function createTypeAgentExplorerProvider(
    explorer: RepositoryExplorer,
    onExecution?: (execution: ExplorerExecution) => void,
): AppAgentProvider {
    return {
        getAppAgentNames: () => [TYPEAGENT_EXPLORER_AGENT],
        getAppAgentManifest: async (appAgentName) => {
            requireExplorer(appAgentName);
            return explorerManifest;
        },
        loadAppAgent: async (appAgentName) => {
            requireExplorer(appAgentName);
            return createExplorerAgent(explorer, onExecution);
        },
        unloadAppAgent: async (appAgentName) => {
            requireExplorer(appAgentName);
        },
    };
}

export function combineTypeAgentUsage(
    translation: TypeAgentUsage,
    reasoning: TypeAgentUsage,
): TokenUsage {
    return {
        inputTokens: translation.inputTokens + reasoning.inputTokens,
        cachedInputTokens:
            translation.cachedInputTokens + reasoning.cachedInputTokens,
        cacheWriteTokens:
            translation.cacheWriteTokens + reasoning.cacheWriteTokens,
        outputTokens: translation.outputTokens + reasoning.outputTokens,
        reasoningOutputTokens:
            translation.reasoningOutputTokens + reasoning.reasoningOutputTokens,
        totalTokens: translation.totalTokens + reasoning.totalTokens,
    };
}

export function assertDirectDispatchEvidence(
    evidence: TypeAgentDispatchEvidence,
    expectedRequest: string,
): void {
    if (
        evidence.ingress !== "natural-language" ||
        evidence.submittedRequest !== expectedRequest ||
        evidence.submittedRequest.trimStart().startsWith("@")
    ) {
        throw new Error(
            "TypeAgent ingress must be the untouched natural-language request",
        );
    }
    if (
        !evidence.translationInvoked ||
        evidence.translationRequestCount !== 1
    ) {
        throw new Error(
            "TypeAgent dispatcher must make exactly one translation request",
        );
    }
    if (
        !isOnlyExplorer(evidence.activeAgentNames) ||
        !isOnlyExplorer(evidence.activeSchemaNames)
    ) {
        throw new Error(
            "Explorer must be the only active application agent and schema",
        );
    }
    if (evidence.translatedActions.length !== 1) {
        throw new Error("TypeAgent must translate exactly one Explorer action");
    }
    const action = evidence.translatedActions[0];
    if (
        action.schemaName !== TYPEAGENT_EXPLORER_AGENT ||
        action.actionName !== TYPEAGENT_EXPLORER_ACTION ||
        !translatedRequestMatchesIngress(
            action.parameters?.request,
            expectedRequest,
        )
    ) {
        throw new Error(
            "TypeAgent translated an unexpected Explorer action or mutated its request",
        );
    }
    if (
        evidence.executionCount !== 1 ||
        !evidence.outputMatchedExecution ||
        !evidence.executionRequestMatchedIngress
    ) {
        throw new Error(
            "Final output must come from one executed Explorer action",
        );
    }
    if (evidence.usedCopilot || evidence.usedMcp) {
        throw new Error("Direct TypeAgent execution cannot use Copilot or MCP");
    }
}

function createExplorerAgent(
    explorer: RepositoryExplorer,
    onExecution?: (execution: ExplorerExecution) => void,
): AppAgent {
    return {
        initializeAgentContext: async () => ({}),
        executeAction: async (action) => {
            requireExploreAction(action);
            const exactRequest = requireExplorerRequest(action);
            if (!explorer.exploreDetailed) {
                throw new Error(
                    "Direct TypeAgent Explorer requires detailed execution telemetry",
                );
            }
            const result = await explorer.exploreDetailed({
                query: exactRequest,
                maxResults: 6,
            });
            const actionResult = createActionResult(
                serializeBenchmarkFinalAnswer(result.text),
            );
            actionResult.tokenUsage = {
                prompt_tokens: result.usage.inputTokens,
                completion_tokens: result.usage.outputTokens,
                total_tokens: result.usage.totalTokens,
            };
            onExecution?.({
                action,
                request: exactRequest,
                result,
                actionResult,
            });
            return actionResult;
        },
    };
}

function requireExploreAction(action: TypeAgentAction): void {
    if (
        action.schemaName !== TYPEAGENT_EXPLORER_AGENT ||
        action.actionName !== TYPEAGENT_EXPLORER_ACTION
    ) {
        throw new Error("Unsupported TypeAgent Explorer action");
    }
}

function requireExplorerRequest(action: TypeAgentAction): string {
    const request = action.parameters?.request;
    if (
        typeof request !== "string" ||
        request.length === 0 ||
        request.trim().length === 0
    ) {
        throw new Error("Explorer action is missing its typed request");
    }
    return request;
}

function requireExplorer(appAgentName: string): void {
    if (appAgentName !== TYPEAGENT_EXPLORER_AGENT) {
        throw new Error(`Unknown application agent: ${appAgentName}`);
    }
}

function isOnlyExplorer(names: string[]): boolean {
    return names.length === 1 && names[0] === TYPEAGENT_EXPLORER_AGENT;
}

function isBuiltinAgentName(name: string): boolean {
    const root = name.split(".", 1)[0];
    return BUILTIN_AGENT_NAMES.has(root);
}

function serializeBenchmarkFinalAnswer(locations: string): string {
    return `<final_answer>\n${locations.trim()}\n</final_answer>`;
}

async function configureTypeAgentRuntime(
    options: TypeAgentRunOptions,
): Promise<string> {
    const environment: Record<string, string> = Object.fromEntries(
        Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
        ),
    );
    if (!environment[options.apiKeyEnv]) {
        const result = spawnSync("launchctl", ["getenv", options.apiKeyEnv], {
            encoding: "utf8",
        });
        const value = result.status === 0 ? result.stdout.trim() : "";
        if (value) {
            environment[options.apiKeyEnv] = value;
        }
    }
    if (options.envFile) {
        Object.assign(environment, await readEnvFile(options.envFile));
    }
    const apiKey = environment[options.apiKeyEnv]?.trim();
    if (!apiKey) {
        throw new Error(
            `Missing ${options.apiKeyEnv}. Set it in the environment, launchctl, or --env-file.`,
        );
    }
    const chatEndpoint = providerChatEndpoint(options.providerBaseUrl);
    const fingerprint = createHash("sha256")
        .update(`${chatEndpoint}\0${options.model}\0${apiKey}`)
        .digest("hex");
    if (configuredRuntime && configuredRuntime !== fingerprint) {
        throw new Error(
            "Direct TypeAgent benchmark supports one provider/model configuration per process",
        );
    }
    if (!configuredRuntime) {
        setRuntimeConfig(
            configFromEnvRecord({
                TYPEAGENT_MODEL_PROVIDER: "openai",
                OPENAI_API_KEY: apiKey,
                OPENAI_ENDPOINT: chatEndpoint,
                OPENAI_MODEL: options.model,
                OPENAI_RESPONSE_FORMAT: "1",
                OPENAI_MAX_RETRYATTEMPTS: "1",
                OPENAI_MAX_TIMEOUT: String(REASONING_REQUEST_TIMEOUT_MS),
            }),
        );
        configuredRuntime = fingerprint;
    }
    return apiKey;
}

function providerChatEndpoint(baseUrl: string): string {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("TypeAgent provider base URL must use http or https");
    }
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (!url.pathname.endsWith("/chat/completions")) {
        url.pathname += "/chat/completions";
    }
    return url.toString();
}

function createBenchmarkLanguageServerOptions(): LanguageServerOptions {
    const pythonLspCommand = path.join(
        packagesRoot,
        "mcp",
        "explore",
        "python-lsp",
        ".venv",
        process.platform === "win32" ? "Scripts" : "bin",
        process.platform === "win32" ? "pylsp.exe" : "pylsp",
    );
    try {
        accessSync(pythonLspCommand, constants.X_OK);
    } catch {
        throw new Error(
            `Pinned Python language server is missing at ${pythonLspCommand}; run uv sync --project packages/mcp/explore/python-lsp --frozen from ts/`,
        );
    }
    return {
        requestTimeoutMs: 30_000,
        servers: createDefaultLanguageServers({
            python: { command: pythonLspCommand, args: [] },
            typescript: defaultTypeScriptLanguageServerCommand(),
        }),
    };
}

function normalizeDispatcherUsage(
    usage: CompletionUsageStats | undefined,
): TypeAgentUsage {
    if (!usage || !usage.requestCount) {
        throw new Error("TypeAgent dispatcher reported no translation usage");
    }
    return {
        requestCount: usage.requestCount,
        usageComplete: true,
        inputTokens: usage.prompt_tokens,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: usage.completion_tokens,
        reasoningOutputTokens: 0,
        totalTokens: usage.total_tokens,
    };
}

function normalizeExplorerUsage(usage: ExploreUsage): TypeAgentUsage {
    return {
        requestCount: usage.requestCount,
        ...(usage.usageComplete !== undefined
            ? { usageComplete: usage.usageComplete }
            : {}),
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteTokens: 0,
        outputTokens: usage.outputTokens,
        reasoningOutputTokens: usage.reasoningOutputTokens,
        totalTokens: usage.totalTokens,
    };
}

function requireActionUsage(
    usage: CompletionUsageStats | undefined,
    expected: TypeAgentUsage,
): void {
    if (
        !usage ||
        usage.prompt_tokens !== expected.inputTokens ||
        usage.completion_tokens !== expected.outputTokens ||
        usage.total_tokens !== expected.totalTokens
    ) {
        throw new Error(
            "TypeAgent dispatcher action usage does not equal Explorer reasoning usage",
        );
    }
}

function requireUsageEqual(
    actual: TypeAgentUsage,
    expected: TypeAgentUsage,
): void {
    for (const key of [
        "requestCount",
        "inputTokens",
        "cachedInputTokens",
        "cacheWriteTokens",
        "outputTokens",
        "reasoningOutputTokens",
        "totalTokens",
    ] as const) {
        if (actual[key] !== expected[key]) {
            throw new Error(
                `TypeAgent Explorer telemetry ${key} does not match executed action usage`,
            );
        }
    }
    if (actual.usageComplete === false || expected.usageComplete === false) {
        throw new Error("TypeAgent Explorer usage is incomplete");
    }
}

function createClientIO(messages: Map<string, IAgentMessage[]>): ClientIO {
    const capture = (message: IAgentMessage): void => {
        messages.get(message.requestId.requestId)?.push(message);
    };
    return {
        clear: () => undefined,
        exit: () => {
            throw new Error("Benchmark dispatcher cannot exit its host");
        },
        shutdown: () => {
            throw new Error("Benchmark dispatcher cannot shut down its host");
        },
        setUserRequest: () => undefined,
        setDisplayInfo: () => undefined,
        setDisplay: capture,
        appendDisplay: capture,
        appendDiagnosticData: () => undefined,
        setDynamicDisplay: () => undefined,
        question: async (
            _requestId: RequestId | undefined,
            _message: string,
            _choices: string[],
            defaultId?: number,
        ) => defaultId ?? 0,
        proposeAction: async () => undefined,
        notify: () => undefined,
        openLocalView: async () => undefined,
        closeLocalView: async () => undefined,
        requestChoice: () => undefined,
        requestInteraction: () => undefined,
        interactionResolved: () => undefined,
        interactionCancelled: () => undefined,
        takeAction: (_requestId, action) => {
            throw new Error(
                `Benchmark dispatcher action ${action} is disabled`,
            );
        },
    };
}

function displayContentToText(content: DisplayContent | undefined): string {
    if (content === undefined) {
        return "";
    }
    const value =
        typeof content === "object" && !Array.isArray(content)
            ? content.content
            : content;
    if (typeof value === "string") {
        return value;
    }
    if (value.length === 0) {
        return "";
    }
    return Array.isArray(value[0])
        ? (value as string[][]).map((row) => row.join("\t")).join("\n")
        : (value as string[]).join("\n");
}
