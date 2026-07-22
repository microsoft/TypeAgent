// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    TypeAgentAction,
    DisplayAppendMode,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ReasoningAction } from "../context/dispatcher/schema/reasoningActionSchema.js";
import {
    CopilotClient,
    RuntimeConnection,
    defineTool,
    approveAll,
    type SessionConfig,
} from "@github/copilot-sdk";
import registerDebug from "debug";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getActionSchemaTypeName } from "../translation/agentTranslators.js";
import {
    composeActionSchema,
    createActionSchemaJsonValidator,
} from "../translation/actionSchemaJsonTranslator.js";
import { TypeAgentJsonValidator } from "typechat-utils";
import { executeAction } from "../execute/actionHandlers.js";
import {
    ConversationMessage,
    ConversationMessageMeta,
} from "conversation-memory";
import { nullClientIO } from "../context/interactiveIO.js";
import { ClientIO, IAgentMessage } from "@typeagent/dispatcher-types";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import { createLimiter } from "@typeagent/common-utils";
import { ReasoningTraceCollector } from "./tracing/traceCollector.js";
import { ReasoningRecipeGenerator } from "./recipeGenerator.js";
import { formatUserContextForPrompt } from "./userContextPrompt.js";
import { reasoningTokenUsage } from "./reasoningLoopBase.js";
import {
    buildReasoningForm,
    formatReasoningFormResponse,
    presentReasoningForm,
} from "./askUserForm.js";

const debug = registerDebug("typeagent:dispatcher:reasoning:copilot");

function withAbortSignal<T>(
    promise: Promise<T>,
    signal: AbortSignal | undefined,
): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            (err) => {
                signal.removeEventListener("abort", onAbort);
                reject(err);
            },
        );
    });
}

const FALLBACK_MODEL = "claude-opus-4.8";

// Default reasoning effort when COPILOT_REASONING_EFFORT is unset/invalid.
// "high" makes the model more likely to actually run verification tool calls
// instead of narrating an intent ("Let me confirm…") and stopping.
const FALLBACK_REASONING_EFFORT = "high" as const;

// Largest delay Node's setTimeout accepts without overflowing (~24.8 days). The
// Copilot SDK feeds sendAndWait's timeout straight into setTimeout, so a larger
// value (or Infinity) would wrap around to a near-zero delay and fire immediately.
const MAX_SETTIMEOUT_MS = 2_147_483_647;

// Client-side cap on how long session.sendAndWait blocks waiting for the Copilot
// session to go idle (finish one full agentic turn). The SDK default is only 60s,
// which spuriously fails legitimate multi-tool reasoning turns that run longer:
// the wait does not abort the agent's in-flight work, so a too-short cap just
// rejects a turn that is still making progress. Genuine cancellation stays with
// context.abortSignal. Matches the Claude path's DEFAULT_REASONING_TIMEOUT_MS and
// honors the same TYPEAGENT_REASONING_TIMEOUT_MS override.
const DEFAULT_REASONING_TIMEOUT_MS = 20 * 60 * 1000;

// Resolve the sendAndWait idle-wait timeout (ms) from TYPEAGENT_REASONING_TIMEOUT_MS,
// falling back to DEFAULT_REASONING_TIMEOUT_MS. 0 means "disabled"; since the SDK
// cannot take 0/Infinity (setTimeout would fire immediately), disabled and any
// too-large value are clamped to the largest delay setTimeout accepts.
export function resolveReasoningTimeoutMs(): number {
    const raw = process.env.TYPEAGENT_REASONING_TIMEOUT_MS;
    const parsed = raw !== undefined ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed < 0) {
        return DEFAULT_REASONING_TIMEOUT_MS;
    }
    return parsed === 0
        ? MAX_SETTIMEOUT_MS
        : Math.min(parsed, MAX_SETTIMEOUT_MS);
}

function resolveModel(context: ActionContext<CommandHandlerContext>): string {
    // Live @config override wins, then the COPILOT_REASONING_MODEL env var
    // (from config.yaml), then the built-in fallback.
    const configured =
        context.sessionContext.agentContext.session.getConfig().execution
            .reasoningModel;
    return (
        configured?.trim() ||
        process.env.COPILOT_REASONING_MODEL?.trim() ||
        FALLBACK_MODEL
    );
}

function resolveReasoningEffort(
    context: ActionContext<CommandHandlerContext>,
): "low" | "medium" | "high" | "xhigh" {
    // Live @config override wins, then COPILOT_REASONING_EFFORT, then the
    // built-in default.
    const configured =
        context.sessionContext.agentContext.session.getConfig().execution
            .reasoningEffort;
    if (configured) {
        return configured;
    }
    const raw = process.env.COPILOT_REASONING_EFFORT?.trim().toLowerCase();
    if (
        raw === "low" ||
        raw === "medium" ||
        raw === "high" ||
        raw === "xhigh"
    ) {
        return raw;
    }
    return FALLBACK_REASONING_EFFORT;
}

/**
 * Resolve the display append mode for reasoning phases based on config.
 * "inline" config → "step" mode (new bubble per phase).
 * "block" config  → "block" mode (legacy single-bubble behavior).
 */
function resolveReasoningDisplayMode(
    context: ActionContext<CommandHandlerContext>,
): DisplayAppendMode {
    const config = context.sessionContext.agentContext.session.getConfig();
    return config.execution.reasoningDisplay === "inline" ? "step" : "block";
}

// Memoize the in-flight Copilot client start per dispatcher instance (WeakMap
// for GC). Caching the PROMISE (not just the resolved client) lets a startup
// prewarm and the first reasoning request share one CLI start instead of
// racing into two.
const copilotClientPromises = new WeakMap<object, Promise<CopilotClient>>();

// Track Copilot session IDs per dispatcher instance (mirrors Claude's session tracking)
const copilotSessionIds = new WeakMap<object, string>();

/**
 * Get the stored session ID for this dispatcher context
 * (Same pattern as Claude implementation)
 */
function getSessionId(
    context: ActionContext<CommandHandlerContext>,
): string | undefined {
    return copilotSessionIds.get(context.sessionContext.agentContext);
}

/**
 * Store the session ID for this dispatcher context
 * (Same pattern as Claude implementation)
 */
function setSessionId(
    context: ActionContext<CommandHandlerContext>,
    sessionId: string,
): void {
    copilotSessionIds.set(context.sessionContext.agentContext, sessionId);
}

/**
 * Clear the stored Copilot reasoning session ID for the given agent context.
 * Call this before starting a new reasoning loop to avoid topic pollution
 * from prior sessions. Exported so @history clear can invoke it.
 */
export function clearReasoningSession(agentContext: object): void {
    copilotSessionIds.delete(agentContext);
}

/**
 * Generate a structured session ID based on the dispatcher session
 * (Mirrors Claude's session ID pattern)
 */
function generateSessionId(
    context: ActionContext<CommandHandlerContext>,
): string {
    const sessionDirPath =
        context.sessionContext.agentContext.session.getSessionDirPath();
    if (sessionDirPath) {
        // Extract session name from path (e.g., "my-session" from ".../sessions/my-session")
        const sessionName = sessionDirPath.split(/[/\\]/).pop() || "default";
        return `typeagent-${sessionName}`;
    }
    // Fallback to timestamp-based ID if no session path
    return `typeagent-reasoning-${Date.now()}`;
}

/**
 * Get the TypeAgent repository root path
 * (Same as Claude implementation)
 */
function getRepoRoot(): string {
    // Navigate up from this file to the repo root
    // Compiled path: packages/dispatcher/dispatcher/dist/reasoning/copilot.js
    // We go up 5 levels to reach ts/ (the monorepo TypeScript root).
    const thisFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(thisFile), "../../../../..");
}

/**
 * Locate the platform-specific native copilot binary bundled by the SDK.
 * Navigates pnpm's virtual store: resolve @github/copilot-sdk, find the
 * @github/copilot sibling directory, follow its symlink to the real path,
 * then locate the platform binary (@github/copilot-<platform>-<arch>)
 * among the real copilot package's siblings.
 */
function findBundledNativeCli(): string | undefined {
    const binaryName = process.platform === "win32" ? "copilot.exe" : "copilot";
    const require = createRequire(import.meta.url);
    try {
        // Resolve our direct dependency @github/copilot-sdk. Its install
        // location is stable across machines (always under the repo's
        // node_modules), but its entry-point *depth* is not — copilot-sdk@0.2.0
        // nests the entry deeper than earlier versions, which broke a
        // hard-coded "../.." climb to the @github scope dir. Instead, walk up
        // from the resolved entry to the enclosing "@github" directory,
        // bounded to the repo root so we never depend on anything above it.
        // Works for both pnpm's isolated store and a hoisted node_modules
        // layout. (@github/copilot itself is not require.resolve-able — its
        // package "exports" blocks both the main entry and package.json.)
        const sdkEntry = require.resolve("@github/copilot-sdk");
        const repoRoot = getRepoRoot();
        let scopeDir = path.dirname(sdkEntry);
        while (
            path.basename(scopeDir) !== "@github" &&
            scopeDir.startsWith(repoRoot) &&
            path.dirname(scopeDir) !== scopeDir
        ) {
            scopeDir = path.dirname(scopeDir);
        }
        if (
            path.basename(scopeDir) !== "@github" ||
            !scopeDir.startsWith(repoRoot)
        ) {
            debug(`Could not locate @github scope dir from: ${sdkEntry}`);
            return undefined;
        }

        // @github/copilot is a (transitive) dependency of the SDK, linked as a
        // sibling of copilot-sdk under the @github scope. Follow the symlink to
        // its real location; the platform binary package
        // (@github/copilot-<platform>-<arch>) is a sibling there.
        const copilotDir = path.join(scopeDir, "copilot");
        if (!existsSync(copilotDir)) {
            debug(`@github/copilot not found at: ${copilotDir}`);
            return undefined;
        }
        const realGithubDir = path.dirname(realpathSync(copilotDir));
        const candidate = path.join(
            realGithubDir,
            `copilot-${process.platform}-${process.arch}`,
            binaryName,
        );
        if (existsSync(candidate)) {
            debug(`Found bundled native CLI: ${candidate}`);
            return candidate;
        }
        debug(`Platform binary not found at: ${candidate}`);
    } catch (err) {
        debug(
            `Could not resolve bundled native CLI for ${process.platform}-${process.arch}:`,
            err,
        );
    }
    return undefined;
}

/**
 * Create + start a Copilot client. Go through getCopilotClient(), which
 * memoizes the in-flight promise so we never start two CLIs concurrently.
 */
async function createCopilotClient(
    agentContext: CommandHandlerContext,
): Promise<CopilotClient> {
    debug("Creating new Copilot client");
    const repoRoot = getRepoRoot();
    debug(`Repo root: ${repoRoot}`);
    debug(`Parent dir: ${path.resolve(repoRoot, "..")}`);

    // When running inside Electron, process.execPath is the Electron
    // binary — not node. The SDK's default getBundledCliPath() resolves
    // to a .js entry point which the SDK then spawns via
    // process.execPath, causing the CLI to exit immediately. To avoid
    // this, resolve the platform-specific native binary from the
    // bundled @github/copilot-<platform> package and pass it as
    // cliPath so the SDK spawns it directly (no node needed).
    const cliPath = await findBundledNativeCli();

    // Isolate the CLI from the user's ~/.claude/settings.json.
    // The Copilot CLI binary internally uses the Anthropic API and
    // reads Claude Code's settings file.  If that file contains a
    // model value with a "[1m]" suffix (e.g. "opus[1m]"), the CLI
    // adds a "context-1m-2025-08-07" beta header that the API
    // rejects for accounts without the 1M-context entitlement.
    // Pointing CLAUDE_CONFIG_DIR at an empty temp directory prevents
    // the CLI from reading those settings while still allowing it
    // to use its own default configuration.
    const isolatedConfigDir = mkdtempSync(
        path.join(os.tmpdir(), "typeagent-copilot-"),
    );

    const client = new CopilotClient({
        connection: RuntimeConnection.forStdio({
            ...(cliPath ? { path: cliPath } : {}),
            args: [
                "--add-dir",
                repoRoot,
                "--add-dir",
                path.resolve(repoRoot, ".."),
                "--allow-all-urls",
                "--allow-all-tools",
            ],
        }),
        env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: isolatedConfigDir,
        },
    });

    try {
        debug("Starting Copilot client...");
        await client.start();
        debug("Copilot client started successfully");

        // Register cleanup on process exit
        process.on("exit", () => {
            debug("Cleaning up Copilot client on exit");
            client.stop().catch((err) => {
                debug("Error stopping client:", err);
            });
        });
        return client;
    } catch (err) {
        debug("Failed to start Copilot client:", err);
        throw new Error(
            `Failed to start Copilot CLI client. Make sure 'copilot' command is available and authenticated.\n` +
                `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

/**
 * Get or create the Copilot client singleton for this dispatcher instance.
 * Memoizes the in-flight promise so a startup prewarm and the first real
 * reasoning request share one CLI start; on failure the cached promise is
 * dropped so a later attempt retries.
 */
function getCopilotClient(
    agentContext: CommandHandlerContext,
): Promise<CopilotClient> {
    let clientP = copilotClientPromises.get(agentContext);
    if (clientP === undefined) {
        clientP = createCopilotClient(agentContext);
        copilotClientPromises.set(agentContext, clientP);
        clientP.catch(() => {
            if (copilotClientPromises.get(agentContext) === clientP) {
                copilotClientPromises.delete(agentContext);
            }
        });
    }
    return clientP;
}

/**
 * Best-effort startup prewarm: begin starting the Copilot CLI client in the
 * background so the first reasoning request doesn't pay the multi-second CLI
 * start cost. No-op unless the configured reasoning engine is Copilot.
 * Failures are swallowed — the on-demand path retries and surfaces them.
 */
export function prewarmCopilotReasoning(
    agentContext: CommandHandlerContext,
): void {
    if (agentContext.session.getConfig().execution.reasoning !== "copilot") {
        return;
    }
    debug("Prewarming Copilot reasoning client at startup");
    void getCopilotClient(agentContext).catch(() => {
        // Ignore — prewarm is best-effort.
    });
}

/**
 * Get recent chat history as formatted text for reasoning context.
 * (Same implementation as Claude)
 */
function getRecentChatContext(
    context: ActionContext<CommandHandlerContext>,
    k?: number,
): string {
    const systemContext = context.sessionContext.agentContext;
    const turns =
        k ?? systemContext.session.getConfig().execution.reasoningHistoryTurns;
    if (turns <= 0) return "";
    // Use raw recent entries rather than export(): export() drops assistant
    // entries that are not preceded by a user entry, which is exactly the
    // connected/agent-server case where user turns are not recorded.
    const recent = systemContext.chatHistory.getRecentEntries(turns);
    if (recent.length === 0) return "";

    const lines = ["[Recent conversation context]"];
    for (const entry of recent) {
        lines.push(
            entry.role === "assistant"
                ? `Assistant (${entry.source}): ${entry.text}`
                : `User: ${entry.text}`,
        );
    }
    return lines.join("\n");
}

/**
 * Build the full prompt with chat history and editor context prepended.
 * (Same implementation as Claude)
 */
function buildPromptWithContext(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): string {
    const parts: string[] = [];
    const chatContext = getRecentChatContext(context);
    if (chatContext) {
        parts.push(chatContext);
    }
    const editorContext = formatUserContextForPrompt(
        context.sessionContext.agentContext.currentOptions?.userContext,
    );
    if (editorContext) {
        parts.push(editorContext);
    }
    if (parts.length === 0) {
        return originalRequest;
    }
    parts.push(`[Current request]\n${originalRequest}`);
    return parts.join("\n\n");
}

/**
 * Format thinking block display with collapsible details
 * (Matches Claude implementation styling exactly)
 */
function formatThinkingDisplay(thinking: string): string {
    const escaped = thinking
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    return [
        `<details class="reasoning-thinking" open>`,
        `<summary>Thinking</summary>`,
        `<pre>${escaped}</pre>`,
        `</details>`,
    ].join("");
}

type ToolInput = Record<string, unknown>;

function asToolInput(value: unknown): ToolInput | undefined {
    return typeof value === "object" && value !== null
        ? (value as ToolInput)
        : undefined;
}

function getStringProp(
    input: ToolInput | undefined,
    key: string,
): string | undefined {
    const value = input?.[key];
    return typeof value === "string" ? value : undefined;
}

/**
 * Format a tool call as a persistent display line.
 */
function parseActionInput(action: unknown): ToolInput | undefined {
    if (typeof action !== "string") {
        return asToolInput(action);
    }

    try {
        return asToolInput(JSON.parse(action));
    } catch {
        const match = action.match(/"actionName"\s*:\s*"([^"]+)"/);
        return match ? { actionName: match[1] } : undefined;
    }
}

function formatExecuteActionDisplay(input: unknown): string {
    const toolInput = asToolInput(input);
    const schema = getStringProp(toolInput, "schemaName") ?? "?";
    // The model sometimes supplies `action` as a JSON string rather than an
    // object, and at tool.execution_start that string can still be
    // mid-stream (truncated). Parse it when possible, otherwise pull the
    // actionName out directly so the label shows the real action, not "?".
    const action = parseActionInput(toolInput?.action);
    const actionName = getStringProp(action, "actionName") ?? "?";
    return `**Tool:** execute_action — \`${schema}.${actionName}\``;
}

function getPrimaryToolArg(input: unknown): string | undefined {
    const toolInput = asToolInput(input);
    const primaryArg =
        getStringProp(toolInput, "command") ??
        getStringProp(toolInput, "path") ??
        getStringProp(toolInput, "filePath") ??
        getStringProp(toolInput, "query") ??
        getStringProp(toolInput, "pattern");
    return typeof primaryArg === "string" && primaryArg.length > 0
        ? primaryArg
        : undefined;
}

function formatToolCallDisplay(toolName: string, input: unknown): string {
    const toolInput = asToolInput(input);
    switch (toolName) {
        case "discover_actions": {
            const schema =
                getStringProp(toolInput, "schemaName") ?? JSON.stringify(input);
            return `**Tool:** discover_actions — schema: \`${schema}\``;
        }
        case "execute_action":
            return formatExecuteActionDisplay(input);
        case "search_memory": {
            const question =
                getStringProp(toolInput, "question") ?? JSON.stringify(input);
            return `**Tool:** search_memory — \`${question}\``;
        }
        case "remember":
            return `**Tool:** remember`;
    }

    // Built-in tools (shell, github/fs/*, github/search/*, ...): show the
    // primary argument so parallel or similar calls are distinguishable
    // instead of rendering as identical "Tool: <name>" bubbles.
    const primaryArg = getPrimaryToolArg(input);
    if (primaryArg) {
        return `**Tool:** ${toolName} — \`${primaryArg}\``;
    }
    return `**Tool:** ${toolName}`;
}

/**
 * Generate a unique request ID for tracing
 */
function generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get Copilot SDK session configuration with TypeAgent tools
 * (Mirrors getClaudeOptions from claude.ts)
 */
function getCopilotSessionConfig(
    context: ActionContext<CommandHandlerContext>,
): SessionConfig {
    const systemContext = context.sessionContext.agentContext;
    // Capture the request's clientIO now, before execute_action transiently
    // swaps systemContext.clientIO for display capture. get_user_context reads
    // through this stable reference so a parallel execute_action can't strand
    // it on the capturing clientIO.
    const baseClientIO = systemContext.clientIO;
    // The originating request id (carries connectionId) so the agent-server
    // routing can prefer THIS client's editor context over other clients on
    // the same conversation.
    const originatorRequestId = systemContext.currentRequestId;
    const activeSchemas = systemContext.agents.getActiveSchemas();

    // Build validators for action schemas (same as Claude)
    const schemaDescriptions: string[] = [];
    const validators = new Map<string, TypeAgentJsonValidator<AppAction>>();

    for (const schemaName of activeSchemas) {
        const actionConfig = systemContext.agents.getActionConfig(schemaName);
        if (getActionSchemaTypeName(actionConfig.schemaType) === undefined) {
            continue;
        }
        schemaDescriptions.push(`- ${schemaName}: ${actionConfig.description}`);
        validators.set(
            schemaName,
            createActionSchemaJsonValidator(
                composeActionSchema([actionConfig], [], systemContext.agents, {
                    activity: false,
                }),
            ),
        );
    }

    // Define custom tools using Copilot SDK (mirrors Claude's MCP tools)
    let actionIndex = 1;

    // Serialize execute_action invocations (see its handler below): the display
    // capture there swaps the shared systemContext.clientIO around an await, and
    // the Copilot SDK dispatches parallel tool calls concurrently. Overlapping
    // handlers would clobber that slot and strand clientIO on an abandoned
    // capture buffer, dropping the final answer and hanging the UI spinner.
    //
    // TODO: Revisit parallel action execution in the dispatcher. This mutex
    // makes concurrent execute_action calls safe by running them one at a time,
    // which is fine for fast actions but loses real overlap when a turn fires
    // multiple slow I/O actions (e.g. two webFetch or claudeTask calls). Doing
    // it properly means capturing per call instead of swapping the shared
    // clientIO (thread a clientIO sink through executeAction/getActionContext),
    // AND isolating the other per-session state executeAction mutates
    // (lastActionSchemaName, streamingActionContext, commandResult accumulation,
    // activityContext, actionIndex). The dispatcher is serial by design today
    // (commandLock = createLimiter(1)), so this is a broader change.
    const executeActionLock = createLimiter(1);

    const discoverTool = defineTool("discover_actions", {
        description: [
            "Discover actions available with a schema name.",
            "Returns a list of action names with parameters as TypeScript schemas.",
            "Schema descriptions:",
            ...schemaDescriptions,
        ].join("\n"),
        parameters: {
            type: "object",
            properties: {
                schemaName: {
                    type: "string",
                    description: "Schema name to discover",
                },
            },
            required: ["schemaName"],
        },
        handler: async (args: any) => {
            const { schemaName } = args;
            debug(`Discovering actions for schema: ${schemaName}`);
            const validator = validators.get(schemaName);
            if (!validator) {
                const errorMsg = `Invalid schema name '${schemaName}'`;
                debug(errorMsg);
                return {
                    textResultForLlm: errorMsg,
                    resultType: "failure" as const,
                    error: errorMsg,
                };
            }
            const schemaText = validator.getSchemaText();
            return {
                textResultForLlm: schemaText,
                resultType: "success" as const,
            };
        },
    });

    const executeTool = defineTool("execute_action", {
        description: [
            "Execute an action based on action schemas discovered using 'discover_actions'.",
            "The action parameter must conform to the schema returned by 'discover_actions'.",
        ].join("\n"),
        parameters: {
            type: "object",
            properties: {
                schemaName: {
                    type: "string",
                    description: "Schema name",
                },
                action: {
                    type: "object",
                    description: "Action to execute",
                    properties: {
                        actionName: {
                            type: "string",
                            description: "Action name",
                        },
                        parameters: {
                            description: "Action parameters",
                        },
                    },
                    required: ["actionName", "parameters"],
                },
            },
            required: ["schemaName", "action"],
        },
        handler: async (args: any) =>
            executeActionLock(async () => {
                const { schemaName, action: actionJson } = args;
                debug(
                    `Executing action: ${schemaName}.${actionJson.actionName}`,
                );
                const validator = validators.get(schemaName);
                if (!validator) {
                    throw new Error(`Invalid schema name '${schemaName}'`);
                }

                const validationResult = validator.validate(actionJson);
                if (!validationResult.success) {
                    throw new Error(validationResult.message);
                }

                // Capture action execution results (same as Claude)
                const result: IAgentMessage[] = [];
                const capturingClientIO: ClientIO = {
                    ...nullClientIO,
                    setDisplay: (message) => {
                        result.push(message);
                    },
                    appendDisplay: (message, mode) => {
                        if (mode !== "temporary") {
                            result.push(message);
                        }
                    },
                };

                const savedClientIO = systemContext.clientIO;
                try {
                    systemContext.clientIO = capturingClientIO;
                    await executeAction(
                        {
                            action: {
                                schemaName,
                                ...actionJson,
                            },
                        },
                        context,
                        actionIndex++,
                    );
                    systemContext.clientIO = savedClientIO;

                    // Return result in Copilot SDK format
                    return {
                        textResultForLlm: JSON.stringify(result),
                        resultType: "success" as const,
                    };
                } catch (error) {
                    systemContext.clientIO = savedClientIO;
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    debug(`Error executing action: ${errorMessage}`);

                    // Return error in Copilot SDK format
                    return {
                        textResultForLlm: `Error executing ${schemaName}.${actionJson.actionName}: ${errorMessage}`,
                        resultType: "failure" as const,
                        error: errorMessage,
                    };
                }
            }),
    });

    const searchMemoryTool = defineTool("search_memory", {
        description: [
            "Search the user's conversation memory to recall information from earlier in this or prior conversations.",
            "Provide a natural language question; returns an answer synthesized from relevant remembered messages.",
        ].join("\n"),
        parameters: {
            type: "object",
            properties: {
                question: {
                    type: "string",
                    description: "Natural language question to recall",
                },
            },
            required: ["question"],
        },
        handler: async (args: any) => {
            const { question } = args;
            debug(`Searching memory: ${question}`);
            const memory = systemContext.conversationMemory;
            if (memory === undefined) {
                return {
                    textResultForLlm: "Conversation memory is not available.",
                    resultType: "success" as const,
                };
            }
            const result = await memory.getAnswerFromLanguage(question);
            if (!result.success) {
                return {
                    textResultForLlm: `Memory search failed: ${result.message}`,
                    resultType: "failure" as const,
                    error: result.message,
                };
            }
            const answers = result.data.map(([, answerResponse]) =>
                answerResponse.type === "Answered"
                    ? answerResponse.answer
                    : `No answer: ${answerResponse.whyNoAnswer}`,
            );
            return {
                textResultForLlm: answers.join("\n\n"),
                resultType: "success" as const,
            };
        },
    });

    const rememberTool = defineTool("remember", {
        description: [
            "Save a new memory to the user's conversation memory so it can be recalled later.",
            "Use this to durably record facts, decisions, or context discovered during reasoning.",
        ].join("\n"),
        parameters: {
            type: "object",
            properties: {
                text: {
                    type: "string",
                    description: "The information to remember",
                },
            },
            required: ["text"],
        },
        handler: async (args: any) => {
            const { text } = args;
            debug(`Remembering: ${text}`);
            const memory = systemContext.conversationMemory;
            if (memory === undefined) {
                return {
                    textResultForLlm: "Conversation memory is not available.",
                    resultType: "success" as const,
                };
            }
            memory.queueAddMessage(
                new ConversationMessage(
                    text,
                    new ConversationMessageMeta("reasoning", ["user"]),
                ),
            );
            return {
                textResultForLlm: "Remembered.",
                resultType: "success" as const,
            };
        },
    });

    // TODO (deferred): cross-conversation browsing. get_conversation_info /
    // read_conversation are scoped to the CURRENT conversation only. To help a
    // user who is unsure which conversation they were in, add
    // list_conversations / read_conversation(conversationId) backed by the
    // agent-server ConversationManager (getConversationList). Not implemented yet.
    const getConversationInfoTool = defineTool("get_conversation_info", {
        description: [
            "Get metadata about the current conversation transcript: total message count and which agents have responded.",
            "Note: in some hosting modes the user's own turns are not recorded in the transcript, so userMessages may be 0 even though the user has spoken.",
            "Use read_conversation to page through the actual messages.",
        ].join("\n"),
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
        handler: async () => {
            const total = systemContext.chatHistory.count();
            const all = systemContext.chatHistory.getEntries(0, total);
            let userMessages = 0;
            const agents = new Set<string>();
            for (const entry of all) {
                if (entry.role === "user") {
                    userMessages++;
                } else if (entry.source) {
                    agents.add(entry.source);
                }
            }
            const info = {
                messageCount: total,
                userMessages,
                assistantMessages: total - userMessages,
                agents: [...agents],
            };
            return {
                textResultForLlm: JSON.stringify(info, null, 2),
                resultType: "success" as const,
            };
        },
    });

    const readConversationTool = defineTool("read_conversation", {
        description: [
            "Read a page of the current conversation transcript in chronological order.",
            "Params: offset (0-based start index, default 0) and limit (max messages, default 20).",
            "For the most recent messages, call get_conversation_info first, then set offset = messageCount - limit.",
        ].join("\n"),
        parameters: {
            type: "object",
            properties: {
                offset: {
                    type: "number",
                    description: "0-based start index (default 0)",
                },
                limit: {
                    type: "number",
                    description:
                        "maximum number of messages to return (default 20)",
                },
            },
            required: [],
        },
        handler: async (args: any) => {
            const total = systemContext.chatHistory.count();
            const offset = typeof args.offset === "number" ? args.offset : 0;
            const limit = typeof args.limit === "number" ? args.limit : 20;
            const page = systemContext.chatHistory.getEntries(offset, limit);
            if (page.length === 0) {
                return {
                    textResultForLlm: `No messages in range (conversation has ${total} message(s)).`,
                    resultType: "success" as const,
                };
            }
            const lines = page.map((entry) =>
                entry.role === "assistant"
                    ? `[${entry.index}] ${entry.source ?? "assistant"}: ${entry.text}`
                    : `[${entry.index}] user: ${entry.text}`,
            );
            const more = offset + page.length < total;
            const header = `Messages ${offset}\u2013${offset + page.length - 1} of ${total}${more ? " (more available — increase offset to continue)" : ""}:`;
            return {
                textResultForLlm: `${header}\n${lines.join("\n")}`,
                resultType: "success" as const,
            };
        },
    });

    const getUserContextTool = defineTool("get_user_context", {
        description: [
            "Get a fresh, coarse snapshot of the user's current editor context:",
            "active file path, language, cursor and selection ranges, workspace",
            "folders, open editor count, and diagnostic counts.",
            "Contains NO file or selection text. To read actual contents, use the",
            "code agent's read actions (getActiveEditor, getSelection,",
            "getFileContent, getDiagnostics) via discover_actions/execute_action.",
        ].join("\n"),
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
        handler: async () => {
            const userContext =
                await baseClientIO.getUserContext?.(originatorRequestId);
            if (!userContext) {
                return {
                    textResultForLlm:
                        "No editor context is available (the client is not an editor, or there is no active editor).",
                    resultType: "success" as const,
                };
            }
            return {
                textResultForLlm: JSON.stringify(userContext, null, 2),
                resultType: "success" as const,
            };
        },
    });

    const askUserTool = defineTool("ask_user", {
        description: [
            "Ask the user ONE multiple-choice question and block until they answer.",
            "Use ONLY when you are genuinely blocked on a decision that only the user",
            "can make - an ambiguous choice among concrete options, or a confirmation",
            "before a destructive or irreversible action. Put the exact options in",
            '`choices` (for a yes/no question use ["Yes", "No"]). Returns the option the',
            "user picked. Prefer acting autonomously; do not ask when a reasonable safe",
            "default exists.",
        ].join("\n"),
        parameters: {
            type: "object",
            properties: {
                question: {
                    type: "string",
                    description: "The question to ask the user.",
                },
                choices: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        'The options to choose from (at least 2). For a yes/no question use ["Yes", "No"].',
                },
            },
            required: ["question", "choices"],
        },
        handler: async (args: any) => {
            const question =
                typeof args?.question === "string" ? args.question : "";
            const choices = Array.isArray(args?.choices)
                ? args.choices.map((c: unknown) => String(c))
                : [];
            if (choices.length < 2) {
                return {
                    textResultForLlm:
                        'ask_user requires at least 2 choices (e.g. ["Yes", "No"]).',
                    resultType: "failure" as const,
                };
            }
            // Use the stable clientIO ref (execute_action transiently swaps
            // systemContext.clientIO). question() blocks on the answer via the
            // async-interaction path (respondToInteraction), which does not take
            // the command lock, so it is safe while reasoning holds it.
            const selected = await baseClientIO.question(
                originatorRequestId,
                question,
                choices,
                undefined,
                "reasoning",
            );
            const answer = choices[selected] ?? choices[0] ?? "";
            return {
                textResultForLlm: `The user selected: "${answer}" (choice index ${selected}).`,
                resultType: "success" as const,
            };
        },
    });

    const askUserFormTool = defineTool("ask_user_form", {
        description: [
            "Ask the user SEVERAL questions at once in a single form and block",
            "until they submit. Prefer this over multiple `ask_user` calls when you",
            "need more than one answer. Each question has an `id`, a `kind`",
            '("pick" = choose one, "multiChoice" = choose any, "yesNo"), a `prompt`,',
            "and (for pick/multiChoice) at least 2 `choices`. Set `allowFreeText`",
            'to let the user type an "Other" value. Returns every answer keyed to its',
            "question. Use ONLY when genuinely blocked on decisions only the user can",
            "make; prefer acting autonomously when a safe default exists.",
        ].join("\n"),
        parameters: {
            type: "object",
            properties: {
                message: {
                    type: "string",
                    description: "Optional heading shown above the questions.",
                },
                questions: {
                    type: "array",
                    description: "One or more questions to present together.",
                    items: {
                        type: "object",
                        properties: {
                            id: {
                                type: "string",
                                description:
                                    "Unique id for this question; answers are keyed by it.",
                            },
                            kind: {
                                type: "string",
                                enum: ["pick", "multiChoice", "yesNo"],
                                description:
                                    '"pick" = choose one, "multiChoice" = choose any, "yesNo" = yes/no.',
                            },
                            prompt: {
                                type: "string",
                                description: "The question text.",
                            },
                            choices: {
                                type: "array",
                                items: { type: "string" },
                                description:
                                    "Options for pick/multiChoice (at least 2). Omit for yesNo.",
                            },
                            allowFreeText: {
                                type: "boolean",
                                description:
                                    'Allow an "Other: ___" free-text option (pick/multiChoice).',
                            },
                        },
                        required: ["id", "kind", "prompt"],
                    },
                },
                paged: {
                    type: "boolean",
                    description:
                        "Present the questions as a step-by-step wizard instead of all at once.",
                },
            },
            required: ["questions"],
        },
        handler: async (args: any) => {
            const built = buildReasoningForm(args ?? {});
            if ("error" in built) {
                return {
                    textResultForLlm: built.error,
                    resultType: "failure" as const,
                };
            }
            const response = await presentReasoningForm(
                baseClientIO,
                originatorRequestId,
                built.form,
            );
            return {
                textResultForLlm: formatReasoningFormResponse(
                    built.form,
                    response,
                ),
                resultType: "success" as const,
            };
        },
    });

    const model = resolveModel(context);
    const reasoningEffort = resolveReasoningEffort(context);

    return {
        clientName: "TypeAgent",
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        streaming: true,
        tools: [
            discoverTool,
            executeTool,
            searchMemoryTool,
            rememberTool,
            getConversationInfoTool,
            readConversationTool,
            getUserContextTool,
            askUserTool,
            askUserFormTool,
        ],
        availableTools: [
            "discover_actions",
            "execute_action",
            "search_memory",
            "remember",
            "get_conversation_info",
            "read_conversation",
            "get_user_context",
            "ask_user",
            "ask_user_form",
            "github/fs/*",
            "github/search/*",
            "shell",
        ],
        workingDirectory: getRepoRoot(),
        onPermissionRequest: approveAll,
        systemMessage: {
            mode: "append" as const,
            content: [
                "# TypeAgent Integration",
                "",
                "You are the reasoning engine for TypeAgent, a multi-agent system.",
                "",
                "## Built-in Tools (USE THESE FIRST)",
                "You have access to powerful built-in capabilities:",
                "- **Web search**: Use your native web search for looking up information online",
                "- **File operations**: `github/fs/*` for reading, writing, editing files",
                "- **Code search**: `github/search/*` for searching code patterns",
                "- **Shell commands**: `shell` for executing terminal commands",
                "",
                "## TypeAgent Action Tools (USE WHEN NEEDED)",
                "For TypeAgent-specific actions like music playback, calendar management, email:",
                "- `discover_actions`: Find available TypeAgent actions by schema name",
                "- `execute_action`: Execute TypeAgent actions conforming to discovered schemas",
                "",
                "## Conversation Memory Tools",
                "- `search_memory`: Recall information from earlier in this or prior conversations",
                "- `remember`: Durably save a new memory so it can be recalled later",
                "- `get_conversation_info`: Get transcript metadata (message count, contributing agents)",
                "- `read_conversation`: Page through the raw conversation transcript (offset/limit)",
                "",
                "## Editor Context Tools",
                "- `get_user_context`: Fresh coarse snapshot of the user's editor (active file path, language, cursor/selection ranges, workspace, diagnostic counts). Contains NO file or selection text.",
                "- For actual file/selection **text**, use the code agent's read actions (getActiveEditor, getSelection, getFileContent, getDiagnostics) via discover_actions/execute_action.",
                "",
                "## User Interaction",
                '- `ask_user`: Ask the user ONE multiple-choice question and block for their answer. Strongly prefer to act autonomously with a safe default; use this ONLY when genuinely blocked on a decision only the user can make (an ambiguous choice among concrete options, or confirmation before a destructive/irreversible action). Provide the exact options (for yes/no use ["Yes", "No"]), and ask at most one such question.',
                "- `ask_user_form`: Ask SEVERAL questions at once (pick / multiChoice / yesNo, optional free-text) in one form and block for all answers. Prefer this over multiple `ask_user` calls when a single blocking moment needs more than one answer.",
                "",
                "## Guidelines",
                '- **For follow-up questions** that refer to earlier turns (e.g. "those", "it", "mine"), consult the [Recent conversation context] block first; use `search_memory` only for older history not shown there',
                "- **PREFER built-in tools** for web search, file operations, and code investigation",
                "- **Use TypeAgent actions** only for domain-specific operations (music, calendar, email, etc.)",
                "- For web search queries → use your native web search capability",
                "- For code operations → use `github/fs/*` and `github/search/*` tools",
                "- For TypeAgent capabilities → use `discover_actions` then `execute_action`",
            ].join("\n"),
        },
    };
}

/**
 * Create a Copilot session, retrying once WITHOUT `reasoningEffort` when the
 * selected model rejects effort configuration (not all models support it — see
 * `capabilities.supports.reasoningEffort`). Keeps reasoning working instead of
 * hard-failing the whole request into the lookup fallback.
 */
async function createCopilotSession(
    client: CopilotClient,
    sessionId: string,
    config: SessionConfig,
): Promise<any> {
    try {
        return await client.createSession({ sessionId, ...config });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
            config.reasoningEffort !== undefined &&
            /reasoning effort/i.test(msg)
        ) {
            debug(
                `Model rejected reasoning effort; retrying session create without it: ${msg}`,
            );
            const { reasoningEffort, ...rest } = config;
            void reasoningEffort;
            return await client.createSession({ sessionId, ...rest });
        }
        throw err;
    }
}

/**
 * Execute reasoning action without planning
 * Uses session ID resumption for multi-turn conversations
 */
async function executeReasoningWithoutPlanning(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    debug(`Executing reasoning request: ${originalRequest}`);
    context.actionIO.appendDisplay("Thinking...", "temporary");
    const displayMode = resolveReasoningDisplayMode(context);

    const client = await getCopilotClient(context.sessionContext.agentContext);
    const config = getCopilotSessionConfig(context);

    // Check for existing session ID to enable multi-turn conversations
    let sessionId = getSessionId(context);
    let session: any = null;

    if (sessionId) {
        // Resume existing session by ID (don't reuse session object)
        debug(`Resuming existing session: ${sessionId}`);
        try {
            session = await client.resumeSession(sessionId, config);
            debug(`Session resumed successfully: ${sessionId}`);
        } catch (err) {
            debug(
                `Failed to resume session ${sessionId}, creating new one:`,
                err,
            );
            session = null;
        }
    }

    if (!session) {
        // Generate structured session ID based on dispatcher session
        sessionId = generateSessionId(context);
        debug(`Creating new session: ${sessionId}`);

        try {
            session = await createCopilotSession(client, sessionId, config);
            debug(`Session created successfully: ${sessionId}`);

            // Store session ID (not the session object) for future resumption
            setSessionId(context, sessionId);
        } catch (err) {
            debug("Failed to create session:", err);
            throw new Error(
                `Failed to create Copilot session.\n` +
                    `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    let finalResult: string | undefined = undefined;
    let currentContent = "";
    let currentReasoning = "";
    // Dedup guard: the Copilot SDK re-emits prior turns' reasoning across a
    // multi-turn tool loop, which would render duplicate thinking bubbles.
    let lastReasoningContent: string | undefined;
    // Accumulate LLM token usage across the (possibly multi-turn) tool loop so
    // it can be reported to the UI as "Action Tokens".
    let usageInputTokens = 0;
    let usageOutputTokens = 0;
    let usageCachedTokens = 0;
    // Per-turn reasoning ("thinking") token counts, tabulated one entry per
    // turn that reported any, so the UI can show a per-block "Thinking Tokens"
    // breakdown. These are a subset of usageOutputTokens (not added again).
    const usageThinkingTokens: number[] = [];

    // Subscribe to reasoning events (thinking blocks)
    const unsubscribeReasoningDelta = session.on(
        "assistant.reasoning_delta",
        (event: any) => {
            if (event.data?.deltaContent) {
                currentReasoning += event.data.deltaContent;
                context.actionIO.appendDisplay(
                    {
                        type: "markdown",
                        content: formatThinkingDisplay(currentReasoning),
                    },
                    "temporary",
                );
            }
        },
    );

    const unsubscribeReasoning = session.on(
        "assistant.reasoning",
        (event: any) => {
            if (
                event.data?.content &&
                event.data.content !== lastReasoningContent
            ) {
                // Final reasoning content - display as permanent thinking block
                lastReasoningContent = event.data.content;
                context.actionIO.appendDisplay(
                    {
                        type: "markdown",
                        content: formatThinkingDisplay(event.data.content),
                    },
                    displayMode,
                );
            }
        },
    );

    // Subscribe to message streaming events
    // Use "temporary" mode so each delta replaces the previous one
    const unsubscribeMessageDelta = session.on(
        "assistant.message_delta",
        (event: any) => {
            if (event.data?.deltaContent) {
                currentContent += event.data.deltaContent;
                context.actionIO.appendDisplay(
                    {
                        type: "markdown",
                        content: currentContent,
                    },
                    "temporary",
                );
            }
        },
    );

    const unsubscribeToolStart = session.on(
        "tool.execution_start",
        (event: any) => {
            debug(
                `Tool execution started event:`,
                JSON.stringify(event, null, 2),
            );
            const toolName =
                event.toolName ||
                event.data?.toolName ||
                event.name ||
                "unknown";
            const parameters =
                event.data?.arguments ||
                event.parameters ||
                event.data?.parameters ||
                {};
            debug(`Tool execution started: ${toolName}`);
            context.actionIO.appendDisplay(
                {
                    type: "markdown",
                    content: formatToolCallDisplay(toolName, parameters),
                    kind: "info",
                },
                displayMode,
            );
        },
    );

    const unsubscribeToolComplete = session.on(
        "tool.execution_complete",
        (event: any) => {
            const toolName =
                event.toolName ||
                event.data?.toolName ||
                event.name ||
                "unknown";
            debug(`Tool execution completed: ${toolName}`);
        },
    );

    const unsubscribeFinalMessage = session.on(
        "assistant.message",
        (event: any) => {
            debug("Received final assistant message");
            if (event.data?.content) {
                finalResult = event.data.content;
            }
        },
    );

    // Track cache read/write tokens separately from fresh input tokens so the
    // UI can report them as a distinct "cached" figure. reasoningTokens (a
    // subset of outputTokens) is tabulated per turn so the UI can show a
    // distinct "Thinking Tokens" figure.
    const unsubscribeUsage = session.on("assistant.usage", (event: any) => {
        usageInputTokens += event.data?.inputTokens ?? 0;
        usageOutputTokens += event.data?.outputTokens ?? 0;
        usageCachedTokens +=
            (event.data?.cacheReadTokens ?? 0) +
            (event.data?.cacheWriteTokens ?? 0);
        const reasoningTokens = event.data?.reasoningTokens ?? 0;
        if (reasoningTokens > 0) {
            usageThinkingTokens.push(reasoningTokens);
        }
    });

    try {
        // Send request with chat history context and wait for completion
        const prompt = buildPromptWithContext(originalRequest, context);
        debug(
            `Prompt length: ${prompt?.length}, first 100 chars: ${prompt?.substring(0, 100) || "undefined"}...`,
        );

        if (!prompt) {
            throw new Error("Prompt is undefined or empty");
        }

        const response: any = await withAbortSignal(
            session.sendAndWait({ prompt }, resolveReasoningTimeoutMs()),
            context.abortSignal,
        );
        debug("Received response from Copilot");
        debug("Response:", JSON.stringify(response, null, 2));

        if (response?.data?.content) {
            finalResult = response.data.content;
        }

        // Display final content as permanent block (replaces temporary
        // streaming display). Prefer the authoritative final message over the
        // streamed accumulation, which can be stale/truncated when the model
        // interleaves tool calls mid-turn (which produced an "unfinished" answer).
        const displayContent = finalResult || currentContent;
        if (displayContent) {
            context.actionIO.appendDisplay(
                {
                    type: "markdown",
                    content: displayContent,
                },
                displayMode,
            );
        } else {
            debug("Warning: No content to display!");
        }

        if (!finalResult) {
            return undefined;
        }
        const result = createActionResultNoDisplay(finalResult);
        result.tokenUsage = reasoningTokenUsage(
            usageInputTokens,
            usageOutputTokens,
            usageCachedTokens,
            usageThinkingTokens,
        );
        return result;
    } catch (error) {
        debug("Error during reasoning:", error);
        context.actionIO.appendDisplay(
            {
                type: "text",
                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
            displayMode,
        );
        throw error;
    } finally {
        // Unsubscribe from all events
        unsubscribeReasoningDelta();
        unsubscribeReasoning();
        unsubscribeMessageDelta();
        unsubscribeToolStart();
        unsubscribeToolComplete();
        unsubscribeFinalMessage();
        unsubscribeUsage();
    }
}

/**
 * Execute reasoning action with trace capture
 * Captures execution traces for plan generation
 */
async function executeReasoningWithTracing(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    const systemContext = context.sessionContext.agentContext;
    const storage = context.sessionContext.sessionStorage;

    if (!storage) {
        debug("No sessionStorage available, using standard reasoning");
        return executeReasoningWithoutPlanning(originalRequest, context);
    }

    const requestId = generateRequestId();

    // Create trace collector
    const tracer = new ReasoningTraceCollector({
        storage,
        sessionId: systemContext.session.getSessionDirPath() || "unknown",
        originalRequest,
        requestId,
        model: resolveModel(context),
        planReuseEnabled: true,
    });

    try {
        debug(`Executing reasoning with tracing: ${originalRequest}`);
        context.actionIO.appendDisplay("Thinking...", "temporary");
        const displayMode = resolveReasoningDisplayMode(context);

        const client = await getCopilotClient(
            context.sessionContext.agentContext,
        );
        const config = getCopilotSessionConfig(context);

        // Check for existing session ID to enable multi-turn conversations
        let sessionId = getSessionId(context);
        let session: any = null;

        if (sessionId) {
            // Resume existing session by ID (don't reuse session object)
            debug(`Resuming existing session: ${sessionId}`);
            try {
                session = await client.resumeSession(sessionId, config);
                debug(`Session resumed successfully: ${sessionId}`);
            } catch (err) {
                debug(
                    `Failed to resume session ${sessionId}, creating new one:`,
                    err,
                );
                session = null;
            }
        }

        if (!session) {
            // Generate structured session ID based on dispatcher session
            sessionId = generateSessionId(context);
            debug(`Creating new session: ${sessionId}`);

            try {
                session = await createCopilotSession(client, sessionId, config);
                debug(`Session created successfully: ${sessionId}`);

                // Store session ID (not the session object) for future resumption
                setSessionId(context, sessionId);
            } catch (err) {
                debug("Failed to create session:", err);
                throw new Error(
                    `Failed to create Copilot session.\n` +
                        `Error: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }

        let finalResult: string | undefined = undefined;
        let currentContent = "";
        let currentReasoning = "";
        // Dedup guard (see executeReasoningWithoutPlanning): the SDK re-emits
        // prior turns' reasoning across the multi-turn tool loop.
        let lastReasoningContent: string | undefined;
        // Accumulate LLM token usage across the (possibly multi-turn) tool loop
        // so it can be reported to the UI as "Action Tokens".
        let usageInputTokens = 0;
        let usageOutputTokens = 0;
        let usageCachedTokens = 0;
        // Per-turn reasoning ("thinking") token counts, tabulated one entry per
        // turn that reported any, so the UI can show a per-block "Thinking
        // Tokens" breakdown. These are a subset of usageOutputTokens (not added
        // again).
        const usageThinkingTokens: number[] = [];

        // Subscribe to reasoning events and record thinking
        const unsubscribeReasoningDelta = session.on(
            "assistant.reasoning_delta",
            (event: any) => {
                if (event.data?.deltaContent) {
                    currentReasoning += event.data.deltaContent;
                    context.actionIO.appendDisplay(
                        {
                            type: "markdown",
                            content: formatThinkingDisplay(currentReasoning),
                        },
                        "temporary",
                    );
                }
            },
        );

        const unsubscribeReasoning = session.on(
            "assistant.reasoning",
            (event: any) => {
                if (
                    event.data?.content &&
                    event.data.content !== lastReasoningContent
                ) {
                    lastReasoningContent = event.data.content;
                    // Record thinking for trace
                    tracer.recordThinking({
                        content: [
                            { type: "thinking", thinking: event.data.content },
                        ],
                    });

                    context.actionIO.appendDisplay(
                        {
                            type: "markdown",
                            content: formatThinkingDisplay(event.data.content),
                        },
                        displayMode,
                    );
                }
            },
        );

        // Subscribe to message streaming
        const unsubscribeMessageDelta = session.on(
            "assistant.message_delta",
            (event: any) => {
                if (event.data?.deltaContent) {
                    currentContent += event.data.deltaContent;
                    context.actionIO.appendDisplay(
                        {
                            type: "markdown",
                            content: currentContent,
                        },
                        "temporary",
                    );
                }
            },
        );

        // Track tool calls for tracing
        const unsubscribeToolStart = session.on(
            "tool.execution_start",
            (event: any) => {
                debug(
                    `Tool execution started event:`,
                    JSON.stringify(event, null, 2),
                );
                const toolName =
                    event.toolName ||
                    event.data?.toolName ||
                    event.name ||
                    "unknown";
                const parameters =
                    event.data?.arguments ||
                    event.parameters ||
                    event.data?.parameters ||
                    {};
                debug(`Tool execution started: ${toolName}`);

                // Record tool call for trace
                tracer.recordToolCall(toolName, parameters);

                context.actionIO.appendDisplay(
                    {
                        type: "markdown",
                        content: formatToolCallDisplay(toolName, parameters),
                        kind: "info",
                    },
                    displayMode,
                );
            },
        );

        const unsubscribeToolComplete = session.on(
            "tool.execution_complete",
            (event: any) => {
                const toolName =
                    event.toolName ||
                    event.data?.toolName ||
                    event.name ||
                    "unknown";
                debug(`Tool execution completed: ${toolName}`);
            },
        );

        const unsubscribeFinalMessage = session.on(
            "assistant.message",
            (event: any) => {
                debug("Received final assistant message");
                if (event.data?.content) {
                    finalResult = event.data.content;
                }
            },
        );

        // Track cache read/write tokens separately from fresh input tokens so
        // the UI can report them as a distinct "cached" figure. reasoningTokens
        // (a subset of outputTokens) is tabulated per turn so the UI can show a
        // distinct "Thinking Tokens" figure.
        const unsubscribeUsage = session.on("assistant.usage", (event: any) => {
            usageInputTokens += event.data?.inputTokens ?? 0;
            usageOutputTokens += event.data?.outputTokens ?? 0;
            usageCachedTokens +=
                (event.data?.cacheReadTokens ?? 0) +
                (event.data?.cacheWriteTokens ?? 0);
            const reasoningTokens = event.data?.reasoningTokens ?? 0;
            if (reasoningTokens > 0) {
                usageThinkingTokens.push(reasoningTokens);
            }
        });

        try {
            const prompt = buildPromptWithContext(originalRequest, context);
            debug(`Sending prompt: ${prompt.substring(0, 100)}...`);

            const response: any = await withAbortSignal(
                session.sendAndWait({ prompt }, resolveReasoningTimeoutMs()),
                context.abortSignal,
            );
            debug("Received response from Copilot");
            debug("Response:", JSON.stringify(response, null, 2));

            if (response?.data?.content) {
                finalResult = response.data.content;
            }

            // Display final content as permanent block (replaces temporary
            // streaming display). Prefer the authoritative final message over
            // the streamed accumulation, which can be stale/truncated when the
            // model interleaves tool calls mid-turn.
            const displayContent = finalResult || currentContent;
            if (displayContent) {
                context.actionIO.appendDisplay(
                    {
                        type: "markdown",
                        content: displayContent,
                    },
                    displayMode,
                );
            } else {
                debug("Warning: No content to display!");
            }

            // Mark trace as successful
            tracer.markSuccess(finalResult);

            // Save trace
            await tracer.saveTrace();

            // Auto-generate recipe from successful trace and save to instance storage
            if (tracer.wasSuccessful()) {
                try {
                    const recipeGen = new ReasoningRecipeGenerator();
                    const recipe = await recipeGen.generate(tracer.getTrace());

                    if (recipe) {
                        const saved = await saveTaskFlowRecipeToStorage(
                            recipe,
                            systemContext,
                        );
                        if (saved) {
                            debug(`TaskFlow recipe saved: ${recipe.name}`);
                            context.actionIO.appendDisplay({
                                type: "text",
                                content: `\n✓ Task flow registered: ${recipe.name}`,
                            });
                            try {
                                await systemContext.agents.reloadAgentSchema(
                                    "taskflow",
                                    systemContext,
                                );
                            } catch {
                                debug(
                                    "Failed to reload taskflow schema after saving recipe",
                                );
                            }
                        }
                    }
                } catch (error) {
                    debug("Failed to generate recipe from trace:", error);
                }
            }

            if (!finalResult) {
                return undefined;
            }
            const result = createActionResultNoDisplay(finalResult);
            result.tokenUsage = reasoningTokenUsage(
                usageInputTokens,
                usageOutputTokens,
                usageCachedTokens,
                usageThinkingTokens,
            );
            return result;
        } finally {
            unsubscribeReasoningDelta();
            unsubscribeReasoning();
            unsubscribeMessageDelta();
            unsubscribeToolStart();
            unsubscribeToolComplete();
            unsubscribeFinalMessage();
            unsubscribeUsage();
        }
    } catch (error) {
        tracer.markFailed(error instanceof Error ? error : String(error));
        await tracer.saveTrace();
        throw error;
    }
}

/**
 * Save a TaskFlow script recipe to instance storage and register as active flow.
 */
async function saveTaskFlowRecipeToStorage(
    recipe: {
        name: string;
        description: string;
        parameters: Array<{
            name: string;
            type: string;
            required: boolean;
            description: string;
            default?: unknown;
        }>;
        script: string;
        grammarPatterns: string[];
        source?: { type: string; sourceId?: string; timestamp: string };
    },
    systemContext: CommandHandlerContext,
): Promise<boolean> {
    const storage =
        systemContext.persistDir && systemContext.storageProvider
            ? systemContext.storageProvider.getStorage(
                  "taskflow",
                  systemContext.persistDir,
              )
            : undefined;
    if (!storage) {
        debug("No instance storage available for taskflow");
        return false;
    }

    let index: {
        version: 1;
        flows: Record<string, unknown>;
        deletedSamples: string[];
        lastModified: string;
    };
    try {
        const indexJson = await storage.read("index.json", "utf8");
        index = JSON.parse(indexJson);
    } catch {
        index = {
            version: 1,
            flows: {},
            deletedSamples: [],
            lastModified: new Date().toISOString(),
        };
    }

    const { name } = recipe;
    if (index.flows[name]) {
        debug(`TaskFlow '${name}' already exists, skipping`);
        return false;
    }

    const flowParams: Record<string, unknown> = {};
    for (const p of recipe.parameters) {
        const def: Record<string, unknown> = { type: p.type };
        if (p.required !== undefined) def.required = p.required;
        if (p.default !== undefined) def.default = p.default;
        if (p.description) def.description = p.description;
        flowParams[p.name] = def;
    }

    // Write flow metadata (without script)
    const flowDef = {
        name,
        description: recipe.description,
        parameters: flowParams,
    };

    const flowPath = `flows/${name}.flow.json`;
    const scriptPath = `scripts/${name}.js`;
    await storage.write(flowPath, JSON.stringify(flowDef, null, 2));
    await storage.write(scriptPath, recipe.script);

    const grammarRules: string[] = [];
    for (const pattern of recipe.grammarPatterns) {
        const captures = [...pattern.matchAll(/\$\((\w+):\w+\)/g)].map(
            (m) => m[1],
        );
        const paramJson =
            captures.length > 0 ? `{ ${captures.join(", ")} }` : "{}";
        grammarRules.push(
            `<${name}> [spacing=optional] = ${pattern}` +
                ` -> { actionName: "${name}", parameters: ${paramJson} };`,
        );
    }

    const parametersMeta = recipe.parameters.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        description: p.description,
    }));

    const now = new Date().toISOString();
    index.flows[name] = {
        actionName: name,
        description: recipe.description,
        flowPath,
        scriptPath,
        grammarRuleText: grammarRules.join("\n"),
        parameters: parametersMeta,
        created: now,
        updated: now,
        source: "reasoning",
        usageCount: 0,
        enabled: true,
    };
    index.lastModified = now;

    await storage.write("index.json", JSON.stringify(index, null, 2));
    debug(`TaskFlow registered as active: ${name}`);
    return true;
}

/**
 * Main entry point for Copilot reasoning actions
 * (Mirrors executeReasoningAction from claude.ts)
 */
export async function executeReasoningAction(
    action: TypeAgentAction<ReasoningAction>,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();

    if (config.execution.reasoning !== "copilot") {
        throw new Error(
            `Reasoning engine is not set to 'copilot' for this session.`,
        );
    }

    // Check Copilot SDK availability
    try {
        // Will throw if not installed
        await import("@github/copilot-sdk");
    } catch (error) {
        throw new Error(
            `GitHub Copilot SDK is not installed. Run: pnpm add @github/copilot-sdk`,
        );
    }

    const request = action.parameters.originalRequest;
    debug(`Received reasoning request: ${request}`);

    const planReuseEnabled = config.execution.planReuse === "enabled";

    return executeReasoning(request, context, {
        planReuseEnabled,
        engine: "copilot",
    });
}

/**
 * Execute reasoning with Copilot SDK
 * (Mirrors executeReasoning from claude.ts)
 */
export async function executeReasoning(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    options?: {
        planReuseEnabled?: boolean;
        engine?: "copilot";
    },
): Promise<any> {
    const engine = options?.engine ?? "copilot";
    if (engine !== "copilot") {
        throw new Error(`Unsupported reasoning engine: ${engine}`);
    }

    const planReuseEnabled = options?.planReuseEnabled ?? false;

    if (!planReuseEnabled) {
        // Standard reasoning without planning
        return executeReasoningWithoutPlanning(request, context);
    }

    // Trace capture + auto recipe generation
    return executeReasoningWithTracing(request, context);
}
