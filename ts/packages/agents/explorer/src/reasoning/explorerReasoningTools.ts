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
    submitted: boolean;
}

export interface ExplorerReasoningTools {
    tools: ReasoningToolDefinition[];
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
    return { trace: [], toolCalls: 0, maxToolCalls, submitted: false };
}

export function createExplorerReasoningTools(
    dispatcher: ExplorerActionDispatcher,
    state: ExplorerReasoningState,
): ExplorerReasoningTools {
    return {
        tools: [
            {
                name: EXECUTE_ACTION_TOOL,
                description: `Execute the next ${EXPLORER_AGENT_NAME} typed action through the TypeAgent dispatcher.`,
                inputSchema: reasoningInputSchema(),
                handler: async (args) => {
                    reserveReasoningToolCall(state);
                    const actionName = stringValue(args.actionName);
                    return traced(state, actionName, async () => {
                        if (!isExplorerActionName(actionName)) {
                            return failure(
                                `Unknown Explorer action: ${actionName ?? "unnamed"}; ${describeArgumentShape(args)}`,
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
                        state.submitted ||= result.submitted;
                        return result.isError
                            ? failure(result.text)
                            : success(result.text);
                    });
                },
                isTerminal: (args, result) => {
                    const text = result.content
                        .map((item) => item.text)
                        .join("\n");
                    return (
                        (result.isError !== true && state.submitted) ||
                        (result.isError === true &&
                            text.startsWith(REPOSITORY_BUDGET_EXHAUSTED))
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

function reasoningInputSchema(): object {
    return {
        oneOf: [
            actionSchema(DISCOVER_REPOSITORY_ACTION),
            actionSchema(REFINE_REPOSITORY_ACTION),
            actionSchema(SUBMIT_EXPLORATION_ACTION),
        ],
    };
}

function actionSchema(actionName: ExplorerActionName): object {
    const parameters =
        actionName === SUBMIT_EXPLORATION_ACTION
            ? {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                      locations: {
                          type: "array",
                          minItems: 1,
                          maxItems: 6,
                          items: {
                              type: "object",
                              additionalProperties: false,
                              properties: {
                                  path: { type: "string" },
                                  startLine: { type: "integer" },
                                  endLine: { type: "integer" },
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
