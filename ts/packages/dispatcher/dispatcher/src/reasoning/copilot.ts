// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { ReasoningAction } from "../context/dispatcher/schema/reasoningActionSchema.js";
import { CopilotClient, defineTool, type SystemMessageConfig, type Tool } from "@github/copilot-sdk";
import registerDebug from "debug";
import { execSync } from "node:child_process";
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

const debug = registerDebug("typeagent:dispatcher:reasoning:copilot");

const defaultModel = "gpt-4o";

// Track Copilot clients per dispatcher instance (WeakMap for GC)
const copilotClients = new WeakMap<object, CopilotClient>();

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
        client = new CopilotClient({
            cliPath,
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
                `Error: ${err instanceof Error ? err.message : String(err)}`
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
 * Get Copilot SDK session configuration with TypeAgent tools
 * (Mirrors getClaudeOptions from claude.ts)
 */
function getCopilotSessionConfig(
    context: ActionContext<CommandHandlerContext>,
): {
    model: string;
    streaming: boolean;
    tools: Tool<unknown>[];
    systemMessage: SystemMessageConfig;
} {
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
                    description: "Schema name to discover"
                }
            },
            required: ["schemaName"]
        },
        handler: async (args: any) => {
            const { schemaName } = args;
            debug(`Discovering actions for schema: ${schemaName}`);
            const validator = validators.get(schemaName);
            if (!validator) {
                throw new Error(`Invalid schema name '${schemaName}'`);
            }
            return {
                schemaText: validator.getSchemaText(),
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
                    description: "Schema name"
                },
                action: {
                    type: "object",
                    description: "Action to execute",
                    properties: {
                        actionName: {
                            type: "string",
                            description: "Action name"
                        },
                        parameters: {
                            description: "Action parameters"
                        }
                    },
                    required: ["actionName", "parameters"]
                }
            },
            required: ["schemaName", "action"]
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
            } finally {
                systemContext.clientIO = savedClientIO;
            }

            return {
                result: JSON.stringify(result),
            };
        },
    });

    return {
        model: defaultModel,
        streaming: true,
        tools: [discoverTool, executeTool],
        systemMessage: {
            mode: "append" as const,
            content: [
                "# TypeAgent Integration",
                "",
                "You are the reasoning engine for TypeAgent, a multi-agent system.",
                "You have access to TypeAgent action execution via custom tools:",
                "- `discover_actions`: Find available actions by schema name",
                "- `execute_action`: Execute actions conforming to discovered schemas",
                "",
                "When the user asks about agent capabilities, use discover_actions first.",
                "When the user asks to perform an action, discover the schema then execute_action.",
            ].join("\n"),
        },
    };
}

/**
 * Execute reasoning action without planning (Phase 1 MVP)
 */
async function executeReasoningWithoutPlanning(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    debug(`Executing reasoning request: ${originalRequest}`);
    context.actionIO.appendDisplay("Thinking...", "temporary");

    const client = await getCopilotClient(context);
    const config = getCopilotSessionConfig(context);

    // Generate session ID for this reasoning session
    const sessionId = `typeagent-reasoning-${Date.now()}`;
    debug(`Creating session: ${sessionId}`);

    let session;
    try {
        session = await client.createSession({
            sessionId,
            ...config,
        });
        debug(`Session created successfully: ${sessionId}`);
    } catch (err) {
        debug("Failed to create session:", err);
        throw new Error(
            `Failed to create Copilot session.\n` +
            `Error: ${err instanceof Error ? err.message : String(err)}`
        );
    }

    let finalResult: string | undefined = undefined;
    let currentContent = "";

    // Subscribe to streaming events
    const unsubscribeMessageDelta = session.on("assistant.message_delta", (event: any) => {
        if (event.data?.deltaContent) {
            currentContent += event.data.deltaContent;
            context.actionIO.appendDisplay(
                {
                    type: "markdown",
                    content: currentContent,
                },
                "block",
            );
        }
    });

    const unsubscribeToolStart = session.on("tool.execution_start", (event: any) => {
        debug(`Tool execution started: ${event.toolName}`);
        context.actionIO.appendDisplay(
            {
                type: "markdown",
                content: formatToolCallDisplay(event.toolName, event.parameters),
                kind: "info",
            },
            "block",
        );
    });

    const unsubscribeToolComplete = session.on("tool.execution_complete", (event: any) => {
        debug(`Tool execution completed: ${event.toolName}`);
    });

    const unsubscribeFinalMessage = session.on("assistant.message", (event: any) => {
        debug("Received final assistant message");
        if (event.data?.content) {
            finalResult = event.data.content;
        }
    });

    try {
        // Send request with chat history context and wait for completion
        const prompt = buildPromptWithContext(originalRequest, context);
        debug(`Sending prompt: ${prompt.substring(0, 100)}...`);

        const response = await session.sendAndWait({ prompt });
        debug("Received response from Copilot");

        if (response?.data?.content) {
            finalResult = response.data.content;
        }

        return finalResult ? createActionResultNoDisplay(finalResult) : undefined;

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
        unsubscribeMessageDelta();
        unsubscribeToolStart();
        unsubscribeToolComplete();
        unsubscribeFinalMessage();
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
            `GitHub Copilot SDK is not installed. Run: pnpm add @github/copilot-sdk`
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
        // Phase 1: Standard reasoning without planning
        return executeReasoningWithoutPlanning(request, context);
    }

    // TODO: Phase 4 - Implement planning support
    debug("Plan reuse enabled but not yet implemented, using standard reasoning");
    return executeReasoningWithoutPlanning(request, context);
}
