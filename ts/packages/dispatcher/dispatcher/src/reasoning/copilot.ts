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
    type SystemMessageConfig,
    type Tool,
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
import { displayStatus } from "@typeagent/agent-sdk/helpers/display";
import { ReasoningTraceCollector } from "./tracing/traceCollector.js";
import { PlanGenerator } from "./planning/planGenerator.js";
import { PlanLibrary } from "./planning/planLibrary.js";
import { PlanMatcher } from "./planning/planMatcher.js";
import { PlanExecutor } from "./planning/planExecutor.js";

const debug = registerDebug("typeagent:dispatcher:reasoning:copilot");

const defaultModel = "gpt-4o";

// Track Copilot clients per dispatcher instance (WeakMap for GC)
const copilotClients = new WeakMap<object, CopilotClient>();

// Track Copilot session IDs per dispatcher instance (mirrors Claude's session tracking)
const copilotSessionIds = new WeakMap<object, string>();

// Track active Copilot sessions per dispatcher instance for reuse
const copilotSessions = new WeakMap<object, any>();

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
 * Get the stored session for this dispatcher context
 */
function getSession(
    context: ActionContext<CommandHandlerContext>,
): any | undefined {
    return copilotSessions.get(context.sessionContext.agentContext);
}

/**
 * Store the session for this dispatcher context
 */
function setSession(
    context: ActionContext<CommandHandlerContext>,
    session: any,
): void {
    copilotSessions.set(context.sessionContext.agentContext, session);
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
    // packages/dispatcher/dispatcher/src/reasoning/copilot.ts -> ../../../../..
    return path.resolve(fileURLToPath(import.meta.url), "../../../../..");
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
): {
    model: string;
    streaming: boolean;
    tools: Tool<unknown>[];
    workingDirectory: string;
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
        tools: [
            discoverTool,
            executeTool,
            "github/fs/*",
            "github/search/*",
            "shell",
        ] as any,
        workingDirectory: getRepoRoot(),
        systemMessage: {
            mode: "append" as const,
            content: [
                "# TypeAgent Integration",
                "",
                "You are the reasoning engine for TypeAgent, a multi-agent system.",
                "",
                "## TypeAgent Action Tools",
                "You have custom tools for TypeAgent action execution:",
                "- `discover_actions`: Find available actions by schema name",
                "- `execute_action`: Execute actions conforming to discovered schemas",
                "",
                "## Code Investigation Tools",
                "You have access to GitHub tool aliases for code operations:",
                "- `github/fs/*`: File operations (read, write, edit files; find files by pattern)",
                "- `github/search/*`: Search code (grep for patterns in files)",
                "- `shell`: Execute shell commands",
                "",
                "## Guidelines",
                "- When asked about agent capabilities → use `discover_actions`",
                "- When asked to perform an action → use `discover_actions` then `execute_action`",
                "- When investigating code → use `github/fs/*` and `github/search/*` tools",
                "- When modifying code → use `github/fs/*` edit operations",
            ].join("\n"),
        },
    };
}

/**
 * Execute reasoning action without planning
 * Uses session persistence and reuse for multi-turn conversations
 */
async function executeReasoningWithoutPlanning(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    debug(`Executing reasoning request: ${originalRequest}`);
    context.actionIO.appendDisplay("Thinking...", "temporary");

    const client = await getCopilotClient(context);
    const config = getCopilotSessionConfig(context);

    // Check for existing session to enable multi-turn conversations
    let session = getSession(context);
    let sessionId = getSessionId(context);

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

            // Store session and session ID for reuse across requests
            setSession(context, session);
            setSessionId(context, sessionId);
        } catch (err) {
            debug("Failed to create session:", err);
            throw new Error(
                `Failed to create Copilot session.\n` +
                    `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    } else {
        debug(`Reusing existing session: ${sessionId}`);
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
            debug(`Tool execution started: ${event.toolName}`);
            context.actionIO.appendDisplay(
                {
                    type: "markdown",
                    content: formatToolCallDisplay(
                        event.toolName,
                        event.parameters,
                    ),
                    kind: "info",
                },
                "block",
            );
        },
    );

    const unsubscribeToolComplete = session.on(
        "tool.execution_complete",
        (event: any) => {
            debug(`Tool execution completed: ${event.toolName}`);
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
        debug(`Sending prompt: ${prompt.substring(0, 100)}...`);

        const response = await session.sendAndWait({ prompt });
        debug("Received response from Copilot");

        if (response?.data?.content) {
            finalResult = response.data.content;
        }

        // Display final content as permanent block (replaces temporary streaming display)
        if (currentContent) {
            context.actionIO.appendDisplay(
                {
                    type: "markdown",
                    content: currentContent,
                },
                "block",
            );
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

        // Check for existing session
        let session = getSession(context);
        let sessionId = getSessionId(context);

        if (!session) {
            sessionId = generateSessionId(context);
            debug(`Creating new session: ${sessionId}`);

            try {
                session = await client.createSession({
                    sessionId,
                    ...config,
                });
                debug(`Session created successfully: ${sessionId}`);

                setSession(context, session);
                setSessionId(context, sessionId);
            } catch (err) {
                debug("Failed to create session:", err);
                throw new Error(
                    `Failed to create Copilot session.\n` +
                        `Error: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        } else {
            debug(`Reusing existing session: ${sessionId}`);
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
                debug(`Tool execution started: ${event.toolName}`);

                // Record tool call for trace
                tracer.recordToolCall(event.toolName, event.parameters);

                context.actionIO.appendDisplay(
                    {
                        type: "markdown",
                        content: formatToolCallDisplay(
                            event.toolName,
                            event.parameters,
                        ),
                        kind: "info",
                    },
                    "block",
                );
            },
        );

        const unsubscribeToolComplete = session.on(
            "tool.execution_complete",
            (event: any) => {
                debug(`Tool execution completed: ${event.toolName}`);
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

            const response = await session.sendAndWait({ prompt });
            debug("Received response from Copilot");

            if (response?.data?.content) {
                finalResult = response.data.content;
            }

            if (currentContent) {
                context.actionIO.appendDisplay(
                    {
                        type: "markdown",
                        content: currentContent,
                    },
                    "block",
                );
            }

            // Mark trace as successful
            tracer.markSuccess(finalResult);

            // Save trace
            await tracer.saveTrace();

            // Generate plan from successful trace
            if (tracer.wasSuccessful()) {
                try {
                    const planGenerator = new PlanGenerator();
                    const planLibrary = new PlanLibrary(
                        storage,
                        context.sessionContext.instanceStorage,
                    );

                    const plan = await planGenerator.generatePlan(
                        tracer.getTrace(),
                    );

                    if (plan && planGenerator.validatePlan(plan)) {
                        // Check for duplicate plans before saving
                        const existingPlans =
                            await planLibrary.findMatchingPlans(
                                originalRequest,
                                plan.intent,
                            );

                        let isDuplicate = false;
                        let duplicatePlanId: string | undefined;

                        if (existingPlans.length > 0) {
                            const planMatcher = new PlanMatcher(planLibrary);

                            for (const existingPlan of existingPlans) {
                                if (
                                    existingPlan.approval?.status === "approved"
                                ) {
                                    debug(
                                        `Found user-approved plan: ${existingPlan.planId}, skipping new plan creation`,
                                    );

                                    await planLibrary.updatePlanUsage(
                                        existingPlan.planId,
                                        true,
                                        tracer.getTrace().metrics.duration,
                                    );

                                    isDuplicate = true;
                                    duplicatePlanId = existingPlan.planId;
                                    break;
                                }

                                const similarity =
                                    await planMatcher.computeSimilarity(
                                        plan.description,
                                        existingPlan.description,
                                    );

                                if (similarity >= 0.8) {
                                    isDuplicate = true;
                                    duplicatePlanId = existingPlan.planId;
                                    debug(
                                        `Detected duplicate plan (similarity: ${similarity}): ${existingPlan.planId}`,
                                    );

                                    await planLibrary.updatePlanUsage(
                                        existingPlan.planId,
                                        true,
                                        tracer.getTrace().metrics.duration,
                                    );
                                    break;
                                }
                            }
                        }

                        if (isDuplicate) {
                            debug(
                                `Skipped creating duplicate plan, updated existing: ${duplicatePlanId}`,
                            );
                            context.actionIO.appendDisplay({
                                type: "text",
                                content: `\n✓ Updated existing workflow plan usage (prevented duplicate)`,
                            });
                        } else {
                            await planLibrary.savePlan(plan);
                            debug(
                                `Generated and saved workflow plan: ${plan.planId} (${plan.intent})`,
                            );

                            context.actionIO.appendDisplay({
                                type: "text",
                                content: `\n✓ Created reusable workflow plan: ${plan.description}`,
                            });
                        }
                    }
                } catch (error) {
                    debug("Failed to generate plan from trace:", error);
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
 * Execute reasoning action with planning
 * Tries to find and execute a matching plan, falls back to reasoning with tracing
 */
async function executeReasoningWithPlanning(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    const storage = context.sessionContext.sessionStorage;

    if (!storage) {
        debug("No sessionStorage available, using standard reasoning");
        return executeReasoningWithoutPlanning(originalRequest, context);
    }

    // Try to find and execute a matching plan
    try {
        const planLibrary = new PlanLibrary(
            storage,
            context.sessionContext.instanceStorage,
        );
        const planMatcher = new PlanMatcher(planLibrary);

        debug("Searching for matching workflow plan...");
        displayStatus("Checking for matching workflow...", context);

        const match = await planMatcher.findBestMatch(originalRequest);

        if (match) {
            debug(
                `Found matching plan: ${match.plan.planId} (confidence: ${match.confidence})`,
            );

            context.actionIO.appendDisplay({
                type: "text",
                content: `\n♻️ Reusing workflow: ${match.plan.description} (confidence: ${Math.round(match.confidence * 100)}%)`,
            });

            const planExecutor = new PlanExecutor();
            const executionResult = await planExecutor.executePlan(
                match.plan,
                originalRequest,
                context,
            );

            if (executionResult.success) {
                await planLibrary.updatePlanUsage(
                    match.plan.planId,
                    true,
                    executionResult.duration,
                );

                debug(
                    `Plan executed successfully in ${executionResult.duration}ms`,
                );

                context.actionIO.appendDisplay({
                    type: "text",
                    content: `\n✓ Workflow completed successfully`,
                });

                if (match.plan.approval?.status === "pending_review") {
                    context.actionIO.appendDisplay({
                        type: "text",
                        content: `\n💡 This workflow is ready for review.`,
                    });
                }

                return executionResult.finalOutput
                    ? createActionResultNoDisplay(executionResult.finalOutput)
                    : undefined;
            } else {
                await planLibrary.updatePlanUsage(
                    match.plan.planId,
                    false,
                    executionResult.duration,
                );

                debug(
                    `Plan execution failed: ${executionResult.error}, falling back to reasoning`,
                );

                context.actionIO.appendDisplay({
                    type: "text",
                    content: `\n⚠️ Workflow failed, using reasoning instead...`,
                });
            }
        } else {
            debug("No matching plan found, using reasoning");
            displayStatus(
                "No matching workflow found, using reasoning...",
                context,
            );
        }
    } catch (error) {
        debug("Plan matching/execution failed:", error);
    }

    // Fallback: Execute reasoning with tracing
    return executeReasoningWithTracing(originalRequest, context);
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

    // Reasoning with planning (trace capture, plan matching, and execution)
    return executeReasoningWithPlanning(request, context);
}
