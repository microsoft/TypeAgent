// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionTokenUsage } from "@typeagent/agent-sdk";
import registerDebug from "debug";

export const loopBaseDebug = registerDebug("typeagent:reasoning:loopBase");

/**
 * A tool definition for reasoning loop execution.
 * SDK-agnostic — each adapter maps these to its native tool format.
 */
export interface ReasoningToolDefinition {
    name: string;
    description: string;
    inputSchema: object;
    handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
}

export interface ReasoningLoopConfig {
    model: string;
    systemPrompt: string | object;
    maxTurns: number;
    tools: ReasoningToolDefinition[];
    traceCollector?: ReasoningTraceCollectorInterface;
    onThinking?: (text: string) => void;
    onToolCall?: (tool: string, args: unknown) => void;
    onToolResult?: (tool: string, result: unknown, isError: boolean) => void;
    onText?: (text: string) => void;
    /**
     * When set, the adapter resumes the prior session with this id rather
     * than starting a fresh conversation. Useful for subagents that need to
     * carry parent/sub-agent dialogue across iterations.
     */
    resumeSessionId?: string;
}

export interface ReasoningTraceCollectorInterface {
    recordThinking(message: unknown): void;
    recordToolCall(toolName: string, parameters: unknown): void;
    recordToolResult(
        toolName: string,
        result: unknown,
        error?: string,
        duration?: number,
    ): void;
    markSuccess(finalOutput?: unknown): void;
    markFailed(error: Error | string): void;
}

/**
 * Normalized event stream from any reasoning SDK.
 */
export type ReasoningEvent =
    | { type: "thinking"; text: string }
    | {
          type: "tool_call";
          tool: string;
          args: Record<string, unknown>;
          id: string;
      }
    | {
          type: "tool_result";
          id: string;
          tool?: string;
          result: unknown;
          isError: boolean;
      }
    | { type: "text"; text: string }
    | {
          type: "done";
          result: { success: boolean; output?: string; error?: string };
      };

/**
 * An SDK adapter creates sessions that produce normalized event streams.
 */
export interface ReasoningSDKAdapter {
    createSession(config: ReasoningLoopConfig): Promise<ReasoningSession>;
}

/**
 * A reasoning session that can be executed with a user message.
 */
export interface ReasoningSession {
    execute(userMessage: string): AsyncIterable<ReasoningEvent>;
    getSessionId(): string | undefined;
}

/**
 * Shared display formatting utilities for reasoning events.
 */
export function formatParams(
    params: Record<string, unknown> | undefined,
): string {
    if (!params || Object.keys(params).length === 0) return "";
    const MAX_VALUE_LEN = 60;
    const pairs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => {
            let s: string;
            if (typeof v === "string") {
                s =
                    v.length > MAX_VALUE_LEN
                        ? `"${v.slice(0, MAX_VALUE_LEN)}…"`
                        : `"${v}"`;
            } else if (typeof v === "object") {
                const j = JSON.stringify(v);
                s =
                    j.length > MAX_VALUE_LEN
                        ? `${j.slice(0, MAX_VALUE_LEN)}…`
                        : j;
            } else {
                s = String(v);
            }
            return `${k}: ${s}`;
        });
    return pairs.length > 0 ? ` \`{ ${pairs.join(", ")} }\`` : "";
}

export function formatToolCallDisplay(
    toolName: string,
    input: unknown,
    mcpPrefix?: string,
): string {
    if (mcpPrefix) {
        const inp = input as Record<string, unknown>;
        if (toolName === `${mcpPrefix}discover_actions`) {
            return `**Tool:** discover_actions — schema: \`${inp.schemaName}\``;
        } else if (toolName === `${mcpPrefix}execute_action`) {
            const actionName =
                (inp.action as Record<string, unknown>)?.actionName ??
                "unknown";
            const params = formatParams(
                (inp.action as Record<string, unknown>)?.parameters as
                    | Record<string, unknown>
                    | undefined,
            );
            return `**Tool:** execute_action — \`${inp.schemaName}.${actionName}\`${params}`;
        } else if (toolName.startsWith(mcpPrefix)) {
            const params = formatParams(inp as Record<string, unknown>);
            return `**Tool:** ${toolName.slice(mcpPrefix.length)}${params}`;
        }
    }
    const params = formatParams(input as Record<string, unknown>);
    return `**Tool:** ${toolName}${params}`;
}

export function formatToolResultDisplay(
    content: string,
    isError: boolean,
): string {
    const MAX_LEN = 120;
    let preview = content.trim().replace(/\n+/g, " ");
    if (preview.length > MAX_LEN) {
        preview = preview.slice(0, MAX_LEN) + "…";
    }
    const label = isError ? "**Error:**" : "**↳**";
    return `${label} \`${preview || "(empty)"}\``;
}

export function formatThinkingDisplay(thinkingText: string): string {
    const escaped = thinkingText
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

/**
 * Build the reasoning token-usage record reported to the dispatcher (surfaced
 * as "Action Tokens" in the UI). Returns undefined when no tokens were counted
 * so the UI shows "not reported" rather than a misleading zero.
 *
 * `thinkingTokens` carries the per-turn reasoning ("thinking") token counts -
 * the subset of completion tokens the model spent on chain-of-thought, one
 * entry per turn that reported any. They are already included in `outputTokens`,
 * so they are reported separately (as a per-block breakdown) rather than added
 * to the total again, letting the UI show a distinct "Thinking Tokens" figure.
 *
 * `thinkingTokensEstimated` marks those counts as an approximate estimate rather
 * than a billed figure (e.g. the Claude SDK only streams a per-block estimate),
 * so the UI can flag them as approximate.
 */
export function reasoningTokenUsage(
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
    thinkingTokens?: number[],
    thinkingTokensEstimated?: boolean,
): ActionTokenUsage | undefined {
    const total = inputTokens + outputTokens + cachedTokens;
    if (total <= 0) {
        return undefined;
    }
    const perBlock = thinkingTokens?.filter((t) => t > 0) ?? [];
    return {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: total,
        ...(cachedTokens > 0 && { cached_tokens: cachedTokens }),
        ...(perBlock.length > 0 && { thinking_tokens: perBlock }),
        ...(perBlock.length > 0 &&
            thinkingTokensEstimated && { thinking_tokens_estimated: true }),
    };
}

/**
 * Process a reasoning session's event stream with display output and optional tracing.
 * Shared loop logic used by all reasoning adapters.
 */
export async function processReasoningSession(
    session: ReasoningSession,
    userMessage: string,
    config: ReasoningLoopConfig,
    display: ReasoningDisplaySink,
): Promise<ReasoningLoopResult> {
    let finalResult: string | undefined;
    let sessionId: string | undefined;

    try {
        for await (const event of session.execute(userMessage)) {
            switch (event.type) {
                case "thinking":
                    config.traceCollector?.recordThinking({
                        content: [{ type: "text", text: event.text }],
                    });
                    config.onThinking?.(event.text);
                    display.appendStep(
                        formatThinkingDisplay(event.text),
                        "html",
                    );
                    break;

                case "text":
                    config.onText?.(event.text);
                    display.appendStep(event.text, "markdown");
                    break;

                case "tool_call":
                    config.traceCollector?.recordToolCall(
                        event.tool,
                        event.args,
                    );
                    config.onToolCall?.(event.tool, event.args);
                    display.appendStep(
                        formatToolCallDisplay(event.tool, event.args),
                        "markdown",
                    );
                    break;

                case "tool_result": {
                    const isError = event.isError;
                    const content =
                        typeof event.result === "string"
                            ? event.result
                            : JSON.stringify(event.result);
                    config.onToolResult?.(
                        event.tool ?? event.id,
                        event.result,
                        isError,
                    );
                    display.appendStep(
                        formatToolResultDisplay(content, isError),
                        "markdown",
                    );
                    break;
                }

                case "done":
                    if (event.result.success) {
                        finalResult = event.result.output;
                        config.traceCollector?.markSuccess(finalResult);
                    } else {
                        config.traceCollector?.markFailed(
                            event.result.error ?? "Unknown error",
                        );
                        throw new Error(
                            event.result.error ?? "Reasoning failed",
                        );
                    }
                    break;
            }
        }

        sessionId = session.getSessionId();
    } catch (error) {
        config.traceCollector?.markFailed(
            error instanceof Error ? error : String(error),
        );
        throw error;
    }

    return { result: finalResult, sessionId };
}

export interface ReasoningLoopResult {
    result: string | undefined;
    sessionId: string | undefined;
}

export interface ReasoningDisplaySink {
    appendMarkdown(content: string): void;
    appendHtml(content: string): void;
    appendInfo(content: string, kind?: "info" | "warning"): void;
    appendTemporary(content: string): void;
    /** Start a new display container/bubble for this content (used for inline reasoning steps). */
    appendStep(content: string, type?: "markdown" | "html"): void;
}
