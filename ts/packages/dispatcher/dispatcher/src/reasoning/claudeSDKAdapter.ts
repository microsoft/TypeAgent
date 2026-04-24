// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createSdkMcpServer,
    Options,
    query,
    SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import {
    ReasoningSDKAdapter,
    ReasoningSession,
    ReasoningEvent,
    ReasoningLoopConfig,
} from "./reasoningLoopBase.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:reasoning:claude:adapter");

const MCP_SERVER_NAME = "reasoning-tools";

/**
 * Adapts the Claude Agent SDK `query()` function into the
 * ReasoningSDKAdapter / ReasoningSession interface.
 *
 * Each session wraps a `query()` async iterable, normalizing
 * Claude-specific message types into ReasoningEvent.
 */
export class ClaudeSDKAdapter implements ReasoningSDKAdapter {
    constructor(private baseOptions: Partial<Options> = {}) {}

    async createSession(
        config: ReasoningLoopConfig,
    ): Promise<ReasoningSession> {
        return new ClaudeReasoningSession(config, this.baseOptions);
    }
}

class ClaudeReasoningSession implements ReasoningSession {
    private sessionId: string | undefined;

    constructor(
        private config: ReasoningLoopConfig,
        private baseOptions: Partial<Options>,
    ) {}

    getSessionId(): string | undefined {
        return this.sessionId;
    }

    async *execute(userMessage: string): AsyncIterable<ReasoningEvent> {
        const options = this.buildOptions();

        const queryInstance = query({
            prompt: userMessage,
            options,
        });

        for await (const message of queryInstance) {
            debug(message);

            if ("session_id" in message && !this.sessionId) {
                this.sessionId = (message as any).session_id;
            }

            if (message.type === "assistant") {
                for (const content of message.message.content) {
                    if (content.type === "text") {
                        yield { type: "text", text: content.text };
                    } else if (content.type === "tool_use") {
                        yield {
                            type: "tool_call",
                            tool: content.name,
                            args: content.input as Record<string, unknown>,
                            id: content.id,
                        };
                    } else if ((content as any).type === "thinking") {
                        const thinkingContent = (content as any).thinking;
                        if (thinkingContent) {
                            yield { type: "thinking", text: thinkingContent };
                        }
                    }
                }
            } else if (message.type === "user") {
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
                            yield {
                                type: "tool_result",
                                id: block.tool_use_id ?? "",
                                result: content,
                                isError,
                            };
                        }
                    }
                }
            } else if (message.type === "result") {
                if (message.subtype === "success") {
                    yield {
                        type: "done",
                        result: { success: true, output: message.result },
                    };
                } else {
                    const errors =
                        "errors" in message
                            ? (message as any).errors
                            : undefined;
                    yield {
                        type: "done",
                        result: {
                            success: false,
                            error: errors?.join(", ") ?? "Unknown error",
                        },
                    };
                }
            }
        }
    }

    private buildOptions(): Options {
        const mcpTools = this.config.tools.map((tool) =>
            this.toMcpToolDefinition(tool),
        );

        const mcpServer = createSdkMcpServer({
            name: MCP_SERVER_NAME,
            tools: mcpTools,
        });

        const allowedTools = [
            `mcp__${MCP_SERVER_NAME}__*`,
            ...(this.baseOptions.allowedTools ?? []),
        ];

        return {
            model: this.config.model,
            maxTurns: this.config.maxTurns,
            systemPrompt:
                typeof this.config.systemPrompt === "string"
                    ? this.config.systemPrompt
                    : (this.config.systemPrompt as any),
            allowedTools,
            canUseTool: async () => ({ behavior: "allow" as const }),
            mcpServers: {
                [MCP_SERVER_NAME]: mcpServer,
            },
            ...(this.config.resumeSessionId
                ? { resume: this.config.resumeSessionId }
                : {}),
            ...this.baseOptions,
        };
    }

    private toMcpToolDefinition(
        tool: (typeof this.config.tools)[number],
    ): SdkMcpToolDefinition<any> {
        const zodSchema = this.objectToZod(
            tool.inputSchema as Record<string, unknown>,
        );
        return {
            name: tool.name,
            description: tool.description,
            inputSchema: zodSchema,
            handler: async (args: Record<string, unknown>) => {
                const result = await tool.handler(args);
                return {
                    content: result.content,
                    isError: result.isError,
                };
            },
        };
    }

    private objectToZod(schema: Record<string, unknown>): Record<string, any> {
        const result: Record<string, any> = {};
        const properties = schema.properties as Record<string, any> | undefined;
        const required = (schema.required as string[]) ?? [];

        if (!properties) return result;

        for (const [key, prop] of Object.entries(properties)) {
            let zodType: any;
            switch (prop.type) {
                case "string":
                    zodType = z.string();
                    break;
                case "number":
                    zodType = z.number();
                    break;
                case "boolean":
                    zodType = z.boolean();
                    break;
                default:
                    zodType = z.any();
                    break;
            }
            if (prop.description) {
                zodType = zodType.describe(prop.description);
            }
            if (!required.includes(key)) {
                zodType = zodType.optional();
            }
            result[key] = zodType;
        }
        return result;
    }
}
