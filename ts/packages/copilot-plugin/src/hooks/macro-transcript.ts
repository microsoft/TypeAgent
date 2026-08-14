// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    redactTraceValue,
    type RecordedInteractionTrace,
    type RecordedToolCall,
} from "@typeagent/copilot-macros";
import { createHash } from "node:crypto";

export { redactTraceValue } from "@typeagent/copilot-macros";

interface TranscriptEvent {
    type?: string;
    timestamp?: string;
    data?: Record<string, unknown>;
}

function getString(data: Record<string, unknown>, ...keys: string[]) {
    for (const key of keys) {
        const value = data[key];
        if (typeof value === "string") return value;
    }
    return undefined;
}

export function normalizeRecordedInteraction(
    jsonl: string,
    sessionId: string,
    cwd: string,
    expectedPromptHash?: string,
): RecordedInteractionTrace | undefined {
    const events: TranscriptEvent[] = [];
    for (const line of jsonl.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            events.push(JSON.parse(line) as TranscriptEvent);
        } catch {
            return undefined;
        }
    }

    let userIndex = -1;
    for (let index = events.length - 1; index >= 0; index--) {
        const content = getString(events[index].data ?? {}, "content");
        if (
            events[index].type === "user.message" &&
            content &&
            (!expectedPromptHash ||
                createHash("sha256").update(content).digest("hex") ===
                    expectedPromptHash)
        ) {
            userIndex = index;
            break;
        }
    }
    if (userIndex < 0) return undefined;

    const nextUserOffset = events
        .slice(userIndex + 1)
        .findIndex((event) => event.type === "user.message");
    const turnEnd =
        nextUserOffset < 0 ? events.length : userIndex + 1 + nextUserOffset;
    const turn = events.slice(userIndex, turnEnd);
    const user = turn[0];
    const prompt = getString(user.data ?? {}, "content");
    if (!prompt || !user.timestamp) return undefined;

    const calls = new Map<string, RecordedToolCall>();
    const completedCalls = new Set<string>();
    const response: string[] = [];
    let completedAt: string | undefined;

    for (const event of turn.slice(1)) {
        const data = event.data ?? {};
        if (event.type === "assistant.message") {
            const content = getString(data, "content");
            if (content) response.push(content);
            const requests = data.toolRequests;
            if (Array.isArray(requests)) {
                for (const request of requests) {
                    if (!request || typeof request !== "object") continue;
                    const item = request as Record<string, unknown>;
                    const toolCallId = getString(item, "toolCallId", "id");
                    const name = getString(item, "name", "toolName");
                    if (!toolCallId || !name) {
                        return undefined;
                    }
                    const mcpServerName = getString(item, "mcpServerName");
                    if (!calls.has(toolCallId)) {
                        calls.set(toolCallId, {
                            toolCallId,
                            name,
                            ...(mcpServerName ? { mcpServerName } : {}),
                            arguments: redactTraceValue(item.arguments),
                            status: "completed",
                        });
                    }
                }
            }
        }

        if (event.type === "tool.execution_start") {
            const toolCallId = getString(data, "toolCallId");
            const name = getString(data, "toolName");
            if (!toolCallId || !name || completedCalls.has(toolCallId)) {
                return undefined;
            }
            const existing = calls.get(toolCallId);
            const mcpServerName = getString(data, "mcpServerName");
            calls.set(toolCallId, {
                toolCallId,
                name,
                ...(mcpServerName ? { mcpServerName } : {}),
                arguments: redactTraceValue(data.arguments),
                status: existing?.status ?? "completed",
                ...(existing?.permission !== undefined
                    ? { permission: existing.permission }
                    : {}),
            });
        }

        if (event.type === "permission.completed") {
            const toolCallId = getString(data, "toolCallId");
            const call = toolCallId ? calls.get(toolCallId) : undefined;
            if (call) {
                call.permission = redactTraceValue(data.result);
                if (
                    typeof data.result === "string" &&
                    (data.result.startsWith("denied") ||
                        data.result === "cancelled")
                ) {
                    call.status = "denied";
                    call.result = call.permission;
                    completedCalls.add(toolCallId!);
                }
            }
        }

        if (event.type === "tool.execution_complete") {
            const toolCallId = getString(data, "toolCallId", "id");
            if (!toolCallId) return undefined;
            const call = calls.get(toolCallId);
            if (!call || completedCalls.has(toolCallId)) return undefined;
            call.result = redactTraceValue(data.result ?? data.error);
            if (call.status !== "denied") {
                call.status = data.success === false ? "failed" : "completed";
            }
            completedCalls.add(toolCallId);
        }

        if (event.timestamp) completedAt = event.timestamp;
    }

    if (!completedAt || completedCalls.size !== calls.size) {
        return undefined;
    }

    return {
        schemaVersion: 1,
        sessionId,
        cwd,
        prompt: redactTraceValue(prompt) as string,
        response: redactTraceValue(response.join("")) as string,
        startedAt: user.timestamp,
        completedAt,
        toolCalls: [...calls.values()],
    };
}
