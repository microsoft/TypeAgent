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

export async function executeReasoningAction(
    action: TypeAgentAction<ReasoningAction>,
    context: ActionContext<CommandHandlerContext>,
): Promise<any> {
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
                    context.actionIO.appendDisplay({
                        type: "markdown",
                        content: content.text,
                    });
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
