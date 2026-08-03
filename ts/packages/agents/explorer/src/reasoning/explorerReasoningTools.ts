// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ReasoningToolDefinition,
    ToolResult,
} from "agent-dispatcher/reasoning";
import {
    DISCOVER_REPOSITORY_ACTION,
    EXPLORER_AGENT_NAME,
    REFINE_REPOSITORY_ACTION,
    REPOSITORY_BUDGET_EXHAUSTED,
    SUBMIT_EXPLORATION_ACTION,
} from "../actionHandler.js";
import type { ExplorerReasoningAttempt } from "../types.js";
import type { ExplorerActionDispatcher } from "./explorerActionDispatcher.js";

export const EXECUTE_ACTION_TOOL = "execute_action";

export type ExplorerActionName =
    | typeof DISCOVER_REPOSITORY_ACTION
    | typeof REFINE_REPOSITORY_ACTION
    | typeof SUBMIT_EXPLORATION_ACTION;

export interface ExplorerReasoningState {
    trace: ExplorerReasoningAttempt[];
    toolCalls: number;
    maxToolCalls: number;
}

export interface ExplorerReasoningTools {
    tools: ReasoningToolDefinition[];
}

export interface ExplorerReasoningToolOptions {
    allowedActions: readonly ExplorerActionName[];
    terminalActions: readonly ExplorerActionName[];
    maxResults: number;
}

export class ExplorerReasoningLimitError extends Error {
    public constructor(maxReasoningToolCalls: number) {
        super(
            `Reasoning loop permits at most ${maxReasoningToolCalls} reasoning tool calls`,
        );
        this.name = "ExplorerReasoningLimitError";
    }
}

export function createExplorerReasoningState(
    maxToolCalls: number,
): ExplorerReasoningState {
    return {
        trace: [],
        toolCalls: 0,
        maxToolCalls,
    };
}

export function createExplorerReasoningTools(
    dispatcher: ExplorerActionDispatcher,
    state: ExplorerReasoningState,
    options: ExplorerReasoningToolOptions,
): ExplorerReasoningTools {
    const allowedActions = new Set(options.allowedActions);
    const terminalActions = new Set(options.terminalActions);
    return {
        tools: [
            {
                name: EXECUTE_ACTION_TOOL,
                description: `Execute the next ${EXPLORER_AGENT_NAME} typed action through the TypeAgent dispatcher.`,
                inputSchema: reasoningInputSchema(
                    options.allowedActions,
                    options.maxResults,
                ),
                handler: async (args) => {
                    reserveReasoningToolCall(state);
                    const actionName = stringValue(args.actionName);
                    return traced(state, actionName, async () => {
                        if (!isExplorerActionName(actionName)) {
                            return failure(
                                `Unknown Explorer action: ${actionName ?? "unnamed"}; ${describeArgumentShape(args)}`,
                            );
                        }
                        if (!allowedActions.has(actionName)) {
                            return failure(
                                `Explorer action ${actionName} is not available in this reasoning phase`,
                            );
                        }
                        const parameters = recordValue(args.parameters);
                        if (!parameters) {
                            return failure(
                                `execute_action requires parameters for ${actionName}`,
                            );
                        }
                        const result = await dispatcher.executeAction(
                            EXPLORER_AGENT_NAME,
                            actionName,
                            parameters,
                        );
                        return result.isError
                            ? failure(result.text)
                            : success(result.text);
                    });
                },
                isTerminal: (args, result) => {
                    if (result.isError === true) {
                        return result.content
                            .map((item) => item.text)
                            .join("\n")
                            .startsWith(REPOSITORY_BUDGET_EXHAUSTED);
                    }
                    const actionName = stringValue(args.actionName);
                    return (
                        isExplorerActionName(actionName) &&
                        terminalActions.has(actionName)
                    );
                },
            },
        ],
    };
}

function reserveReasoningToolCall(state: ExplorerReasoningState): void {
    if (state.toolCalls >= state.maxToolCalls) {
        throw new ExplorerReasoningLimitError(state.maxToolCalls);
    }
    state.toolCalls++;
}

async function traced(
    state: ExplorerReasoningState,
    actionName: string | undefined,
    operation: () => Promise<ToolResult>,
): Promise<ToolResult> {
    const attempt: ExplorerReasoningAttempt = {
        index: state.trace.length,
        tool: EXECUTE_ACTION_TOOL,
        ...(actionName ? { actionName } : {}),
        status: "failed",
    };
    state.trace.push(attempt);
    try {
        const result = await operation();
        if (result.isError) {
            attempt.error = result.content.map((item) => item.text).join("\n");
        } else {
            attempt.status = "completed";
        }
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempt.error = message;
        return failure(message);
    }
}

function reasoningInputSchema(
    allowedActions: readonly ExplorerActionName[],
    maxResults: number,
): object {
    const schemas = allowedActions.map((actionName) =>
        actionSchema(actionName, maxResults),
    );
    return schemas.length === 1 ? schemas[0] : { oneOf: schemas };
}

function actionSchema(
    actionName: ExplorerActionName,
    maxResults: number,
): object {
    const parameters =
        actionName === SUBMIT_EXPLORATION_ACTION
            ? {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                      locations: {
                          type: "array",
                          minItems: 1,
                          maxItems: maxResults,
                          description:
                              "The complete high-confidence set of independently evidenced change-bearing blocks. Include each grounded plausible site when evidence remains ambiguous, plus companion files or multiple blocks when the request or observed dependency indicates that they must change.",
                          items: {
                              type: "object",
                              additionalProperties: false,
                              properties: {
                                  path: {
                                      type: "string",
                                      description:
                                          "Repository-relative path containing the change-bearing block.",
                                  },
                                  startLine: {
                                      type: "integer",
                                      minimum: 1,
                                      description:
                                          "First line of the complete enclosing change-bearing block.",
                                  },
                                  endLine: {
                                      type: "integer",
                                      minimum: 1,
                                      description:
                                          "Last line of the complete enclosing change-bearing block.",
                                  },
                              },
                              required: ["path", "startLine", "endLine"],
                          },
                      },
                  },
                  required: ["locations"],
              }
            : {
                  type: "object",
                  additionalProperties: false,
                  properties: { program: { type: "string" } },
                  required: ["program"],
              };
    return {
        type: "object",
        additionalProperties: false,
        properties: {
            actionName: { type: "string", const: actionName },
            parameters,
        },
        required: ["actionName", "parameters"],
    };
}

function isExplorerActionName(
    value: string | undefined,
): value is ExplorerActionName {
    return (
        value === DISCOVER_REPOSITORY_ACTION ||
        value === REFINE_REPOSITORY_ACTION ||
        value === SUBMIT_EXPLORATION_ACTION
    );
}

function success(text: string): ToolResult {
    return { content: [{ type: "text", text }] };
}

function failure(text: string): ToolResult {
    return { content: [{ type: "text", text }], isError: true };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
}

function describeArgumentShape(value: Record<string, unknown>): string {
    const topLevelKeys = Object.keys(value).sort();
    return `top-level keys [${topLevelKeys.join(", ")}]`;
}
