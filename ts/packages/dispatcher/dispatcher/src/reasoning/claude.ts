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
    // "Read",
    // "Write",
    // "Edit",
    // "Bash",
    // "Glob",
    // "Grep",
    "WebSearch",
    "WebFetch",
    "Task",
    // "NotebookEdit",
    "TodoWrite",
    // Allow all tools from the command-executor MCP server
    `mcp__${mcpServerName}__*`,
];

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

    const claudeOptions: Options = {
        model,
        permissionMode: "acceptEdits",
        allowedTools,
        cwd: process.cwd(),
        // settingSources: ["project"],
        maxTurns: 20,
        maxThinkingTokens: 10000,
        mcpServers: {
            [mcpServerName]: createSdkMcpServer({
                name: mcpServerName,
                tools: [discoverTool, executeTool],
            }),
        },
    };
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
    action: TypeAgentAction<ReasoningAction>,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    const systemContext = context.sessionContext.agentContext;
    if (systemContext.session.getConfig().execution.reasoning !== "claude") {
        throw new Error(
            `Reasoning model is not set to 'claude' for this session.`,
        );
    }
    const originalRequest = action.parameters.originalRequest;

    // Display initial message
    context.actionIO.appendDisplay("Thinking...", "temporary");

    // Create query to Claude Agent SDK
    const queryInstance = query({
        prompt: originalRequest,
        options: getClaudeOptions(context),
    });

    let finalResult: string | undefined = undefined;
    // Process streaming response
    for await (const message of queryInstance) {
        debug(message);
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
                    const toolName = content.name;
                    if (
                        toolName === `mcp__${mcpServerName}__discover_actions`
                    ) {
                        displayStatus(
                            `Discovering actions in '${(content.input as any).schemaName}'...`,
                            context,
                        );
                    } else if (
                        toolName === `mcp__${mcpServerName}__execute_action`
                    ) {
                        const schemaName = (content.input as any).schemaName;
                        const actionName = (content.input as any).action
                            .actionName;
                        displayStatus(
                            `Executing action '${schemaName}.${actionName}'...`,
                            context,
                        );
                    } else {
                        displayStatus(
                            `Calling tool '${content.name}'...'`,
                            context,
                        );
                    }
                } else if ((content as any).type === "thinking") {
                    displayStatus("Thinking...", context);
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
    action: TypeAgentAction<ReasoningAction>,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    const systemContext = context.sessionContext.agentContext;
    const storage = context.sessionContext.sessionStorage;

    if (!storage) {
        // No session storage available - fallback to standard reasoning
        debug("No sessionStorage available, using standard reasoning");
        return executeReasoningWithoutPlanning(action, context);
    }

    const originalRequest = action.parameters.originalRequest;
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

        // Create query to Claude Agent SDK
        const queryInstance = query({
            prompt: originalRequest,
            options: getClaudeOptions(context),
        });

        let finalResult: string | undefined = undefined;

        // Process streaming response with tracing
        for await (const message of queryInstance) {
            debug(message);

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
                        const toolName = content.name;

                        // Record tool call
                        tracer.recordToolCall(toolName, content.input);

                        if (
                            toolName ===
                            `mcp__${mcpServerName}__discover_actions`
                        ) {
                            displayStatus(
                                `Discovering actions in '${(content.input as any).schemaName}'...`,
                                context,
                            );
                        } else if (
                            toolName === `mcp__${mcpServerName}__execute_action`
                        ) {
                            const schemaName = (content.input as any)
                                .schemaName;
                            const actionName = (content.input as any).action
                                .actionName;
                            displayStatus(
                                `Executing action '${schemaName}.${actionName}'...`,
                                context,
                            );
                        } else {
                            displayStatus(
                                `Calling tool '${content.name}'...'`,
                                context,
                            );
                        }
                    } else if ((content as any).type === "thinking") {
                        displayStatus("Thinking...", context);
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
    action: TypeAgentAction<ReasoningAction>,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
    const storage = context.sessionContext.sessionStorage;

    if (!storage) {
        // No session storage available - fallback to standard reasoning
        debug("No sessionStorage available, using standard reasoning");
        return executeReasoningWithoutPlanning(action, context);
    }

    const originalRequest = action.parameters.originalRequest;

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
    return executeReasoningWithTracing(action, context);
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

    // Check if plan reuse is enabled
    const planReuseEnabled = config.execution.planReuse === "enabled";

    if (!planReuseEnabled) {
        // Standard reasoning without planning
        return executeReasoningWithoutPlanning(action, context);
    }

    // Reasoning with planning (trace capture)
    return executeReasoningWithPlanning(action, context);
}
