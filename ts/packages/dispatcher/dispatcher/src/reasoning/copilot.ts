// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ReasoningAction } from "../context/dispatcher/schema/reasoningActionSchema.js";
import {
    CopilotClient,
    defineTool,
    approveAll,
    type SessionConfig,
} from "@github/copilot-sdk";
import registerDebug from "debug";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getActionSchemaTypeName } from "../translation/agentTranslators.js";
import {
    composeActionSchema,
    createActionSchemaJsonValidator,
} from "../translation/actionSchemaJsonTranslator.js";
import { TypeAgentJsonValidator } from "typechat-utils";
import { executeAction } from "../execute/actionHandlers.js";
import { nullClientIO } from "../context/interactiveIO.js";
import { ClientIO, IAgentMessage } from "@typeagent/dispatcher-types";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import { ReasoningTraceCollector } from "./tracing/traceCollector.js";
import { ReasoningRecipeGenerator } from "./recipeGenerator.js";

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

const defaultModel = "gpt-4o";

// Track Copilot clients per dispatcher instance (WeakMap for GC)
const copilotClients = new WeakMap<object, CopilotClient>();

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
 * Find the copilot CLI executable path
 * Uses 'where' on Windows or 'which' on Unix
 */
function findCopilotPath(): string {
    try {
        const isWindows = process.platform === "win32";
        const command = isWindows ? "where copilot" : "which copilot";
        const result = execSync(command, { encoding: "utf8" }).trim();

        // On Windows, 'where' may return multiple lines; take the first one
        const path = result.split("\n")[0].trim();
        debug(`Found copilot CLI at: ${path}`);
        return path;
    } catch (error) {
        debug("Could not find copilot CLI in PATH");
        // Fallback to just "copilot" and let the SDK handle the error
        return "copilot";
    }
}

/**
 * Get or create Copilot client singleton for this dispatcher instance
 */
async function getCopilotClient(
    context: ActionContext<CommandHandlerContext>,
): Promise<CopilotClient> {
    const agentContext = context.sessionContext.agentContext;
    let client = copilotClients.get(agentContext);

    if (!client) {
        debug("Creating new Copilot client");
        const cliPath = findCopilotPath();
        const repoRoot = getRepoRoot();
        debug(`Repo root: ${repoRoot}`);
        debug(`Parent dir: ${path.resolve(repoRoot, "..")}`);
        client = new CopilotClient({
            cliPath,
            cliArgs: [
                "--add-dir",
                repoRoot,
                "--add-dir",
                path.resolve(repoRoot, ".."),
                "--allow-all-urls",
                "--allow-all-tools",
            ],
        });

        try {
            debug("Starting Copilot client...");
            await client.start();
            debug("Copilot client started successfully");
            copilotClients.set(agentContext, client);

            // Register cleanup on process exit
            process.on("exit", () => {
                debug("Cleaning up Copilot client on exit");
                client?.stop().catch((err) => {
                    debug("Error stopping client:", err);
                });
            });
        } catch (err) {
            debug("Failed to start Copilot client:", err);
            throw new Error(
                `Failed to start Copilot CLI client. Make sure 'copilot' command is available and authenticated.\n` +
                    `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    return client;
}

/**
 * Get recent chat history as formatted text for reasoning context.
 * (Same implementation as Claude)
 */
function getRecentChatContext(
    context: ActionContext<CommandHandlerContext>,
    k: number = 4,
): string {
    const chatHistory = context.sessionContext.agentContext.chatHistory;
    const exported = chatHistory.export();
    if (!exported) return "";

    const entries = Array.isArray(exported) ? exported : [exported];
    const recent = entries.slice(-k);
    if (recent.length === 0) return "";

    const lines = ["[Recent conversation context]"];
    for (const entry of recent) {
        lines.push(`User: ${entry.user}`);
        const assistants = Array.isArray(entry.assistant)
            ? entry.assistant
            : [entry.assistant];
        for (const a of assistants) {
            lines.push(`Assistant (${a.source}): ${a.text}`);
        }
    }
    return lines.join("\n");
}

/**
 * Build the full prompt with chat history context prepended.
 * (Same implementation as Claude)
 */
function buildPromptWithContext(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): string {
    const chatContext = getRecentChatContext(context);
    if (chatContext) {
        return `${chatContext}\n\n[Current request]\n${originalRequest}`;
    }
    return originalRequest;
}

/**
 * Format thinking block display with collapsible details
 * (Matches Claude implementation styling exactly)
 */
function formatThinkingDisplay(thinking: string, isStreaming: boolean): string {
    const escaped = thinking
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    return [
        `<details class="reasoning-thinking"${isStreaming ? "" : " open"}>`,
        `<summary>Thinking</summary>`,
        `<pre>${escaped}</pre>`,
        `</details>`,
    ].join("");
}

/**
 * Format a tool call as a persistent display line.
 */
function formatToolCallDisplay(toolName: string, input: any): string {
    if (toolName === "discover_actions") {
        return `**Tool:** discover_actions — schema: \`${input.schemaName}\``;
    } else if (toolName === "execute_action") {
        const actionName = input.action?.actionName ?? "unknown";
        return `**Tool:** execute_action — \`${input.schemaName}.${actionName}\``;
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
        handler: async (args: any) => {
            const { schemaName, action: actionJson } = args;
            debug(`Executing action: ${schemaName}.${actionJson.actionName}`);
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
        },
    });

    return {
        clientName: "TypeAgent",
        model: defaultModel,
        streaming: true,
        tools: [discoverTool, executeTool],
        availableTools: [
            "discover_actions",
            "execute_action",
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
                "## Guidelines",
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
 * Execute reasoning action without planning
 * Uses session ID resumption for multi-turn conversations
 */
async function executeReasoningWithoutPlanning(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    debug(`Executing reasoning request: ${originalRequest}`);
    context.actionIO.appendDisplay("Thinking...", "temporary");

    const client = await getCopilotClient(context);
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
            session = await client.createSession({
                sessionId,
                ...config,
            });
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

    // Subscribe to reasoning events (thinking blocks)
    const unsubscribeReasoningDelta = session.on(
        "assistant.reasoning_delta",
        (event: any) => {
            if (event.data?.deltaContent) {
                currentReasoning += event.data.deltaContent;
                context.actionIO.appendDisplay(
                    {
                        type: "markdown",
                        content: formatThinkingDisplay(currentReasoning, true),
                    },
                    "temporary",
                );
            }
        },
    );

    const unsubscribeReasoning = session.on(
        "assistant.reasoning",
        (event: any) => {
            if (event.data?.content) {
                // Final reasoning content - display as permanent thinking block
                context.actionIO.appendDisplay(
                    {
                        type: "markdown",
                        content: formatThinkingDisplay(
                            event.data.content,
                            false,
                        ),
                    },
                    "block",
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
                event.parameters ||
                event.data?.parameters ||
                event.args ||
                event.data?.args ||
                {};
            debug(`Tool execution started: ${toolName}`);
            context.actionIO.appendDisplay(
                {
                    type: "markdown",
                    content: formatToolCallDisplay(toolName, parameters),
                    kind: "info",
                },
                "block",
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
            session.sendAndWait({ prompt }),
            context.abortSignal,
        );
        debug("Received response from Copilot");
        debug("Response:", JSON.stringify(response, null, 2));

        if (response?.data?.content) {
            finalResult = response.data.content;
        }

        // Display final content as permanent block (replaces temporary streaming display)
        const displayContent = currentContent || finalResult;
        if (displayContent) {
            context.actionIO.appendDisplay(
                {
                    type: "markdown",
                    content: displayContent,
                },
                "block",
            );
        } else {
            debug("Warning: No content to display!");
        }

        return finalResult
            ? createActionResultNoDisplay(finalResult)
            : undefined;
    } catch (error) {
        debug("Error during reasoning:", error);
        context.actionIO.appendDisplay(
            {
                type: "text",
                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
            "block",
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
        model: defaultModel,
        planReuseEnabled: true,
    });

    try {
        debug(`Executing reasoning with tracing: ${originalRequest}`);
        context.actionIO.appendDisplay("Thinking...", "temporary");

        const client = await getCopilotClient(context);
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
                session = await client.createSession({
                    sessionId,
                    ...config,
                });
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

        // Subscribe to reasoning events and record thinking
        const unsubscribeReasoningDelta = session.on(
            "assistant.reasoning_delta",
            (event: any) => {
                if (event.data?.deltaContent) {
                    currentReasoning += event.data.deltaContent;
                    context.actionIO.appendDisplay(
                        {
                            type: "markdown",
                            content: formatThinkingDisplay(
                                currentReasoning,
                                true,
                            ),
                        },
                        "temporary",
                    );
                }
            },
        );

        const unsubscribeReasoning = session.on(
            "assistant.reasoning",
            (event: any) => {
                if (event.data?.content) {
                    // Record thinking for trace
                    tracer.recordThinking({
                        content: [
                            { type: "thinking", thinking: event.data.content },
                        ],
                    });

                    context.actionIO.appendDisplay(
                        {
                            type: "markdown",
                            content: formatThinkingDisplay(
                                event.data.content,
                                false,
                            ),
                        },
                        "block",
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
                    event.parameters ||
                    event.data?.parameters ||
                    event.args ||
                    event.data?.args ||
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
                    "block",
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

        try {
            const prompt = buildPromptWithContext(originalRequest, context);
            debug(`Sending prompt: ${prompt.substring(0, 100)}...`);

            const response: any = await withAbortSignal(
                session.sendAndWait({ prompt }),
                context.abortSignal,
            );
            debug("Received response from Copilot");
            debug("Response:", JSON.stringify(response, null, 2));

            if (response?.data?.content) {
                finalResult = response.data.content;
            }

            // Display final content as permanent block (replaces temporary streaming display)
            const displayContent = currentContent || finalResult;
            if (displayContent) {
                context.actionIO.appendDisplay(
                    {
                        type: "markdown",
                        content: displayContent,
                    },
                    "block",
                );
            } else {
                debug("Warning: No content to display!");
            }

            // Mark trace as successful
            tracer.markSuccess(finalResult);

            // Save trace
            await tracer.saveTrace();

            // Auto-generate recipe from successful trace
            if (tracer.wasSuccessful()) {
                try {
                    const recipeGen = new ReasoningRecipeGenerator();
                    const recipe = await recipeGen.generate(tracer.getTrace());

                    if (recipe) {
                        const pendingDir = path.join(
                            getRepoRoot(),
                            "packages",
                            "agents",
                            "taskflow",
                            "pending",
                        );
                        const { saveRecipe } = await import(
                            "taskflow-typeagent/recipeCompiler"
                        );
                        const filePath = await saveRecipe(recipe, pendingDir);
                        debug(`Recipe saved: ${filePath}`);
                        context.actionIO.appendDisplay({
                            type: "text",
                            content: `\n✓ Recipe saved: ${recipe.actionName}.recipe.json`,
                        });
                    }
                } catch (error) {
                    debug("Failed to generate recipe from trace:", error);
                }
            }

            return finalResult
                ? createActionResultNoDisplay(finalResult)
                : undefined;
        } finally {
            unsubscribeReasoningDelta();
            unsubscribeReasoning();
            unsubscribeMessageDelta();
            unsubscribeToolStart();
            unsubscribeToolComplete();
            unsubscribeFinalMessage();
        }
    } catch (error) {
        tracer.markFailed(error instanceof Error ? error : String(error));
        await tracer.saveTrace();
        throw error;
    }
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
