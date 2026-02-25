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
    createSdkMcpServer,
    Options,
    query,
    SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import registerDebug from "debug";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { getActionSchemaTypeName } from "../translation/agentTranslators.js";
import {
    composeActionSchema,
    createActionSchemaJsonValidator,
} from "../translation/actionSchemaJsonTranslator.js";
import { TypeAgentJsonValidator } from "typechat-utils";
import { executeAction } from "../execute/actionHandlers.js";
import { nullClientIO } from "../context/interactiveIO.js";
import { ClientIO, IAgentMessage } from "@typeagent/dispatcher-types";
import { displayStatus } from "@typeagent/agent-sdk/helpers/display";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import { ReasoningTraceCollector } from "./tracing/traceCollector.js";
import { PlanGenerator } from "./planning/planGenerator.js";
import { PlanLibrary } from "./planning/planLibrary.js";
import { PlanMatcher } from "./planning/planMatcher.js";
import { PlanExecutor } from "./planning/planExecutor.js";
const debug = registerDebug("typeagent:dispatcher:reasoning:messages");

const model = "claude-sonnet-4-5-20250929";

const mcpServerName = "action-executor";
const allowedTools = [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "Task",
    "NotebookEdit",
    "TodoWrite",
    // Allow all tools from the command-executor MCP server
    `mcp__${mcpServerName}__*`,
];

/**
 * Compute the TypeAgent repo root from this module's location.
 * Compiled path: packages/dispatcher/dispatcher/dist/reasoning/claude.js
 * We go up 5 levels to reach ts/ (the monorepo TypeScript root).
 */
function getRepoRoot(): string {
    const thisFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(thisFile), "../../../../..");
}

// Track reasoning session per dispatcher instance (WeakMap so GC cleans up)
const reasoningSessionIds = new WeakMap<object, string>();

function getSessionId(
    context: ActionContext<CommandHandlerContext>,
): string | undefined {
    return reasoningSessionIds.get(context.sessionContext.agentContext);
}

function setSessionId(
    context: ActionContext<CommandHandlerContext>,
    sessionId: string,
): void {
    reasoningSessionIds.set(context.sessionContext.agentContext, sessionId);
}

/**
 * Get recent chat history as formatted text for reasoning context.
 * Returns the last k user/assistant turn pairs from the shell conversation.
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
 * Render tool input parameters as a compact inline string.
 * Omits undefined/null values; truncates long strings.
 */
function formatParams(params: Record<string, any> | undefined): string {
    if (!params || Object.keys(params).length === 0) return "";
    const MAX_VALUE_LEN = 60;
    const pairs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => {
            let s: string;
            if (typeof v === "string") {
                s = v.length > MAX_VALUE_LEN ? `"${v.slice(0, MAX_VALUE_LEN)}…"` : `"${v}"`;
            } else if (typeof v === "object") {
                const j = JSON.stringify(v);
                s = j.length > MAX_VALUE_LEN ? `${j.slice(0, MAX_VALUE_LEN)}…` : j;
            } else {
                s = String(v);
            }
            return `${k}: ${s}`;
        });
    return pairs.length > 0 ? ` \`{ ${pairs.join(", ")} }\`` : "";
}

/**
 * Format a tool call as a persistent display line.
 */
function formatToolCallDisplay(toolName: string, input: any): string {
    const mcpPrefix = `mcp__${mcpServerName}__`;
    if (toolName === `${mcpPrefix}discover_actions`) {
        return `**Tool:** discover_actions — schema: \`${input.schemaName}\``;
    } else if (toolName === `${mcpPrefix}execute_action`) {
        const actionName = input.action?.actionName ?? "unknown";
        const params = formatParams(input.action?.parameters);
        return `**Tool:** execute_action — \`${input.schemaName}.${actionName}\`${params}`;
    } else if (toolName.startsWith(mcpPrefix)) {
        const params = formatParams(input);
        return `**Tool:** ${toolName.slice(mcpPrefix.length)}${params}`;
    }
    // Built-in Claude Code tools — show key input field(s)
    const params = formatParams(input);
    return `**Tool:** ${toolName}${params}`;
}

/**
 * Format a tool result for display. Truncates long results and strips noise.
 */
function formatToolResultDisplay(content: string, isError: boolean): string {
    const MAX_LEN = 120;
    let preview = content.trim().replace(/\n+/g, " ");
    if (preview.length > MAX_LEN) {
        preview = preview.slice(0, MAX_LEN) + "…";
    }
    const label = isError ? "**Error:**" : "**↳**";
    return `${label} \`${preview || "(empty)"}\``;
}

/**
 * Render thinking content as a collapsible HTML details/summary block.
 */
function formatThinkingDisplay(thinkingText: string): string {
    // Escape HTML entities in thinking text for safe embedding
    const escaped = thinkingText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    return [
        `<details class="reasoning-thinking">`,
        `<summary>Thinking</summary>`,
        `<pre>${escaped}</pre>`,
        `</details>`,
    ].join("");
}

function getClaudeOptions(
    context: ActionContext<CommandHandlerContext>,
): Options {
    const systemContext = context.sessionContext.agentContext;
    const activeSchemas = systemContext.agents.getActiveSchemas();
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

    const discoverSchema = {
        schemaName: z.union(activeSchemas.map((s) => z.literal(s))),
    };
    const discoverTool: SdkMcpToolDefinition<typeof discoverSchema> = {
        name: "discover_actions",
        description: [
            "Discover actions available with a schema name.",
            "Returns a list of action names with parameters as TypeScript schemas in the named schema that can be used with 'execute_action' tool.",
            "Schema descriptions:",
            ...schemaDescriptions,
        ].join("\n"),
        inputSchema: discoverSchema,
        handler: async (args) => {
            const validator = validators.get(args.schemaName);
            if (!validator) {
                throw new Error(`Invalid schema name '${args.schemaName}'`);
            }
            return {
                content: [
                    {
                        type: "text",
                        text: validator.getSchemaText(),
                    },
                ],
            };
        },
    };

    let actionIndex = 1;
    const executeSchema = {
        schemaName: z.union(activeSchemas.map((s) => z.literal(s))),
        action: z.object({ actionName: z.string(), parameters: z.any() }),
    };
    const executeTool: SdkMcpToolDefinition<typeof executeSchema> = {
        name: "execute_action",
        description: [
            "Execute an actions based on action schemas discovered using the 'discover_actions' tool.",
            "The action parameter must conform to the schema of the specified schema name returned by 'discover_actions' tool.",
        ].join("\n"),
        inputSchema: executeSchema,
        handler: async (args) => {
            const validator = validators.get(args.schemaName);
            if (!validator) {
                throw new Error(`Invalid schema name '${args.schemaName}'`);
            }
            const actionJson = args.action;
            const validationResult = validator.validate(actionJson);
            if (!validationResult.success) {
                throw validationResult.message;
            }

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
                            schemaName: args.schemaName,
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
                content: [{ type: "text", text: JSON.stringify(result) }],
            };
        },
    };

    const sessionId = getSessionId(context);
    const claudeOptions: Options = {
        model,
        permissionMode: "acceptEdits",
        // Auto-allow all tool calls — we've already curated allowedTools
        canUseTool: async () => ({ behavior: "allow" as const }),
        allowedTools,
        cwd: getRepoRoot(),
        settingSources: ["project"],
        maxTurns: 20,
        maxThinkingTokens: 10000,
        systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: [
                "# TypeAgent Integration",
                "",
                "You are the reasoning engine for TypeAgent, a multi-agent system.",
                "You have access to TypeAgent action execution via MCP tools:",
                "- `discover_actions`: Find available actions by schema name",
                "- `execute_action`: Execute actions conforming to discovered schemas",
                "",
                "You also have full code tools (Read, Glob, Grep, Edit, Bash) for investigating and modifying the codebase.",
                "",
                "When the user asks about agent capabilities, use discover_actions first.",
                "When the user asks to perform an action, discover the schema then execute_action.",
            ].join("\n"),
        },
        mcpServers: {
            [mcpServerName]: createSdkMcpServer({
                name: mcpServerName,
                tools: [discoverTool, executeTool],
            }),
        },
    };

    if (sessionId) {
        claudeOptions.resume = sessionId;
    }

    return claudeOptions;
}

/**
 * Generate a unique request ID for tracing
 */
function generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Execute reasoning action without planning (standard mode)
 */
async function executeReasoningWithoutPlanning(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    // Display initial message
    context.actionIO.appendDisplay("Thinking...", "temporary");

    // Create query to Claude Agent SDK with chat history context
    const queryInstance = query({
        prompt: buildPromptWithContext(originalRequest, context),
        options: getClaudeOptions(context),
    });

    let finalResult: string | undefined = undefined;

    // Process streaming response
    for await (const message of queryInstance) {
        debug(message);
        // Capture session ID from first message for future resume
        if ("session_id" in message && !getSessionId(context)) {
            setSessionId(context, (message as any).session_id);
        }
        if (message.type === "assistant") {
            for (const content of message.message.content) {
                if (content.type === "text") {
                    // Update display with current thinking content
                    // REVIEW: assume markdown?
                    context.actionIO.appendDisplay(
                        {
                            type: "markdown",
                            content: content.text,
                        },
                        "block",
                    );
                } else if (content.type === "tool_use") {
                    context.actionIO.appendDisplay(
                        {
                            type: "markdown",
                            content: formatToolCallDisplay(
                                content.name,
                                content.input,
                            ),
                            kind: "info",
                        },
                        "block",
                    );
                } else if ((content as any).type === "thinking") {
                    const thinkingContent = (content as any).thinking;
                    if (thinkingContent) {
                        context.actionIO.appendDisplay(
                            {
                                type: "html",
                                content: formatThinkingDisplay(thinkingContent),
                            },
                            "block",
                        );
                    }
                }
            }
        } else if (message.type === "user") {
            // Tool results come back as user messages with tool_result blocks
            const msg = (message as any).message;
            if (msg?.content) {
                for (const block of msg.content) {
                    if (block.type === "tool_result") {
                        const isError = block.is_error || false;
                        let content = "";
                        if (Array.isArray(block.content)) {
                            for (const cb of block.content) {
                                if (cb.type === "text") content += cb.text;
                            }
                        } else if (typeof block.content === "string") {
                            content = block.content;
                        }
                        context.actionIO.appendDisplay(
                            {
                                type: "markdown",
                                content: formatToolResultDisplay(content, isError),
                                kind: isError ? "warning" : "info",
                            },
                            "block",
                        );
                    }
                }
            }
        } else if (message.type === "result") {
            // Final result from the agent
            if (message.subtype === "success") {
                finalResult = message.result;
            } else {
                // Handle error results
                const errors =
                    "errors" in message ? (message as any).errors : undefined;
                const errorMessage = `Error: ${errors?.join(", ") || "Unknown error"}`;
                throw new Error(errorMessage);
            }
        }
    }

    return finalResult ? createActionResultNoDisplay(finalResult) : undefined;
}

/**
 * Execute reasoning action with trace capture (no plan execution)
 */
async function executeReasoningWithTracing(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    const systemContext = context.sessionContext.agentContext;
    const storage = context.sessionContext.sessionStorage;

    if (!storage) {
        // No session storage available - fallback to standard reasoning
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
        model,
        planReuseEnabled: true,
    });

    try {
        // Display initial message
        context.actionIO.appendDisplay("Thinking...", "temporary");

        // Create query to Claude Agent SDK with chat history context
        const queryInstance = query({
            prompt: buildPromptWithContext(originalRequest, context),
            options: getClaudeOptions(context),
        });

        let finalResult: string | undefined = undefined;

        // Process streaming response with tracing
        for await (const message of queryInstance) {
            debug(message);
            // Capture session ID from first message for future resume
            if ("session_id" in message && !getSessionId(context)) {
                setSessionId(context, (message as any).session_id);
            }

            if (message.type === "assistant") {
                // Record thinking
                tracer.recordThinking(message.message);

                for (const content of message.message.content) {
                    if (content.type === "text") {
                        // Update display with current thinking content
                        context.actionIO.appendDisplay({
                            type: "markdown",
                            content: content.text,
                        });
                    } else if (content.type === "tool_use") {
                        // Record tool call for tracing
                        tracer.recordToolCall(content.name, content.input);

                        context.actionIO.appendDisplay(
                            {
                                type: "markdown",
                                content: formatToolCallDisplay(
                                    content.name,
                                    content.input,
                                ),
                                kind: "info",
                            },
                            "block",
                        );
                    } else if ((content as any).type === "thinking") {
                        const thinkingContent = (content as any).thinking;
                        if (thinkingContent) {
                            context.actionIO.appendDisplay(
                                {
                                    type: "html",
                                    content:
                                        formatThinkingDisplay(thinkingContent),
                                },
                                "block",
                            );
                        }
                    }
                }
            } else if (message.type === "user") {
                // Tool results come back as user messages with tool_result blocks
                const msg = (message as any).message;
                if (msg?.content) {
                    for (const block of msg.content) {
                        if (block.type === "tool_result") {
                            const isError = block.is_error || false;
                            let content = "";
                            if (Array.isArray(block.content)) {
                                for (const cb of block.content) {
                                    if (cb.type === "text") content += cb.text;
                                }
                            } else if (typeof block.content === "string") {
                                content = block.content;
                            }
                            context.actionIO.appendDisplay(
                                {
                                    type: "markdown",
                                    content: formatToolResultDisplay(content, isError),
                                    kind: isError ? "warning" : "info",
                                },
                                "block",
                            );
                        }
                    }
                }
            } else if (message.type === "result") {
                // Final result from the agent
                if (message.subtype === "success") {
                    finalResult = message.result;
                } else {
                    // Handle error results
                    const errors =
                        "errors" in message
                            ? (message as any).errors
                            : undefined;
                    const errorMessage = `Error: ${errors?.join(", ") || "Unknown error"}`;
                    throw new Error(errorMessage);
                }
            }
        }

        // Mark trace as successful
        tracer.markSuccess(finalResult);

        // Save trace
        await tracer.saveTrace();

        // Phase 2: Generate plan from successful trace
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
                    const existingPlans = await planLibrary.findMatchingPlans(
                        originalRequest,
                        plan.intent,
                    );

                    let isDuplicate = false;
                    let duplicatePlanId: string | undefined;

                    if (existingPlans.length > 0) {
                        // Use PlanMatcher to check if this plan is essentially a duplicate
                        const planMatcher = new PlanMatcher(planLibrary);

                        for (const existingPlan of existingPlans) {
                            // Check if existing plan is user-approved
                            if (existingPlan.approval?.status === "approved") {
                                debug(
                                    `Found user-approved plan: ${existingPlan.planId}, skipping new plan creation`,
                                );

                                // Update usage of approved plan instead
                                await planLibrary.updatePlanUsage(
                                    existingPlan.planId,
                                    true,
                                    tracer.getTrace().metrics.duration,
                                );

                                isDuplicate = true;
                                duplicatePlanId = existingPlan.planId;
                                break;
                            }

                            // Check if the descriptions are very similar
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

                                // Update the existing plan's usage count
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

                        // Notify user that a plan was created
                        context.actionIO.appendDisplay({
                            type: "text",
                            content: `\n✓ Created reusable workflow plan: ${plan.description}`,
                        });
                    }
                }
            } catch (error) {
                // Don't fail the request if plan generation fails
                debug("Failed to generate plan from trace:", error);
            }
        }

        return finalResult
            ? createActionResultNoDisplay(finalResult)
            : undefined;
    } catch (error) {
        // Mark trace as failed and save
        tracer.markFailed(error instanceof Error ? error : String(error));
        await tracer.saveTrace();
        throw error;
    }
}

/**
 * Execute reasoning action with planning (Phase 3: plan execution + fallback)
 */
async function executeReasoningWithPlanning(
    originalRequest: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    const storage = context.sessionContext.sessionStorage;

    if (!storage) {
        // No session storage available - fallback to standard reasoning
        debug("No sessionStorage available, using standard reasoning");
        return executeReasoningWithoutPlanning(originalRequest, context);
    }

    // Phase 3: Try to find and execute a matching plan
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

            // Notify user about plan reuse
            context.actionIO.appendDisplay({
                type: "text",
                content: `\n♻️ Reusing workflow: ${match.plan.description} (confidence: ${Math.round(match.confidence * 100)}%)`,
            });

            // Execute the plan
            const planExecutor = new PlanExecutor();
            const executionResult = await planExecutor.executePlan(
                match.plan,
                originalRequest,
                context,
            );

            if (executionResult.success) {
                // Update plan usage statistics
                await planLibrary.updatePlanUsage(
                    match.plan.planId,
                    true,
                    executionResult.duration,
                );

                debug(
                    `Plan executed successfully in ${executionResult.duration}ms`,
                );

                // Notify user of success
                context.actionIO.appendDisplay({
                    type: "text",
                    content: `\n✓ Workflow completed successfully`,
                });

                // Prompt for review if plan is pending
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
                // Plan execution failed - update stats and fallback
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

                // Fall through to reasoning
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
        // Fall through to reasoning
    }

    // Fallback: Execute reasoning with tracing
    return executeReasoningWithTracing(originalRequest, context);
}

/**
 * Main entry point for reasoning actions
 * Checks config and routes to appropriate implementation
 */
export async function executeReasoningAction(
    action: TypeAgentAction<ReasoningAction>,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    const systemContext = context.sessionContext.agentContext;
    const config = systemContext.session.getConfig();
    if (config.execution.reasoning !== "claude") {
        throw new Error(
            `Reasoning model is not set to 'claude' for this session.`,
        );
    }

    const request = action.parameters.originalRequest;
    debug(`Received reasoning request: ${request}`);

    // Check if plan reuse is enabled
    const planReuseEnabled = config.execution.planReuse === "enabled";

    return executeReasoning(request, context, {
        planReuseEnabled,
        engine: "claude",
    });
}

export async function executeReasoning(
    request: string,
    context: ActionContext<CommandHandlerContext>,
    options?: {
        planReuseEnabled?: boolean; // false by default
        engine?: "claude"; // default is "claude" for now
    },
) {
    const engine = options?.engine ?? "claude";
    if (engine !== "claude") {
        throw new Error(`Unsupported reasoning engine: ${engine}`);
    }
    const planReuseEnabled = options?.planReuseEnabled ?? false;
    if (!planReuseEnabled) {
        // Standard reasoning without planning
        return executeReasoningWithoutPlanning(request, context);
    }

    // Reasoning with planning (trace capture)
    return executeReasoningWithPlanning(request, context);
}
