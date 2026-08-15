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

function parseTranscript(jsonl: string): TranscriptEvent[] | undefined {
    const events: TranscriptEvent[] = [];
    for (const line of jsonl.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            events.push(JSON.parse(line) as TranscriptEvent);
        } catch {
            return undefined;
        }
    }
    return events;
}

function matchesPrompt(
    event: TranscriptEvent,
    expectedPromptHash?: string,
): boolean {
    if (event.type !== "user.message") return false;
    const content = getString(event.data ?? {}, "content");
    if (!content) return false;
    const normalizedContent = redactTraceValue(content) as string;
    return (
        !expectedPromptHash ||
        createHash("sha256").update(normalizedContent).digest("hex") ===
            expectedPromptHash
    );
}

function findTurn(
    events: TranscriptEvent[],
    expectedPromptHash?: string,
): TranscriptEvent[] | undefined {
    let userIndex = events.length - 1;
    while (
        userIndex >= 0 &&
        !matchesPrompt(events[userIndex], expectedPromptHash)
    ) {
        userIndex--;
    }
    if (userIndex < 0) return undefined;

    const nextUserOffset = events
        .slice(userIndex + 1)
        .findIndex((event) => event.type === "user.message");
    const turnEnd =
        nextUserOffset < 0 ? events.length : userIndex + 1 + nextUserOffset;
    return events.slice(userIndex, turnEnd);
}

interface TraceAccumulator {
    calls: Map<string, RecordedToolCall>;
    completedCalls: Set<string>;
    response: string[];
}

function recordAssistantMessage(
    data: Record<string, unknown>,
    accumulator: TraceAccumulator,
): boolean {
    const content = getString(data, "content");
    if (content) accumulator.response.push(content);
    if (!Array.isArray(data.toolRequests)) return true;

    for (const request of data.toolRequests) {
        if (!request || typeof request !== "object") continue;
        const item = request as Record<string, unknown>;
        const toolCallId = getString(item, "toolCallId", "id");
        const name = getString(item, "name", "toolName");
        if (!toolCallId || !name) return false;
        if (accumulator.calls.has(toolCallId)) continue;

        const mcpServerName = getString(item, "mcpServerName");
        accumulator.calls.set(toolCallId, {
            toolCallId,
            name,
            ...(mcpServerName ? { mcpServerName } : {}),
            arguments: redactTraceValue(item.arguments),
            status: "completed",
        });
    }
    return true;
}

function recordToolStart(
    data: Record<string, unknown>,
    accumulator: TraceAccumulator,
): boolean {
    const toolCallId = getString(data, "toolCallId");
    const name = getString(data, "toolName");
    if (!toolCallId || !name || accumulator.completedCalls.has(toolCallId)) {
        return false;
    }
    const existing = accumulator.calls.get(toolCallId);
    const mcpServerName = getString(data, "mcpServerName");
    accumulator.calls.set(toolCallId, {
        toolCallId,
        name,
        ...(mcpServerName ? { mcpServerName } : {}),
        arguments: redactTraceValue(data.arguments),
        status: existing?.status ?? "completed",
        ...(existing?.permission !== undefined
            ? { permission: existing.permission }
            : {}),
    });
    return true;
}

function recordPermission(
    data: Record<string, unknown>,
    accumulator: TraceAccumulator,
): void {
    const toolCallId = getString(data, "toolCallId");
    const call = toolCallId ? accumulator.calls.get(toolCallId) : undefined;
    if (!call) return;

    call.permission = redactTraceValue(data.result);
    if (
        typeof data.result === "string" &&
        (data.result.startsWith("denied") || data.result === "cancelled")
    ) {
        call.status = "denied";
        call.result = call.permission;
        accumulator.completedCalls.add(toolCallId!);
    }
}

function recordToolCompletion(
    data: Record<string, unknown>,
    accumulator: TraceAccumulator,
): boolean {
    const toolCallId = getString(data, "toolCallId", "id");
    if (!toolCallId) return false;
    const call = accumulator.calls.get(toolCallId);
    if (!call || accumulator.completedCalls.has(toolCallId)) return false;

    call.result = redactTraceValue(data.result ?? data.error);
    if (call.status !== "denied") {
        call.status = data.success === false ? "failed" : "completed";
    }
    accumulator.completedCalls.add(toolCallId);
    return true;
}

function recordEvent(
    event: TranscriptEvent,
    accumulator: TraceAccumulator,
): boolean {
    const data = event.data ?? {};
    switch (event.type) {
        case "assistant.message":
            return recordAssistantMessage(data, accumulator);
        case "tool.execution_start":
            return recordToolStart(data, accumulator);
        case "permission.completed":
            recordPermission(data, accumulator);
            return true;
        case "tool.execution_complete":
            return recordToolCompletion(data, accumulator);
        default:
            return true;
    }
}

export function normalizeRecordedInteraction(
    jsonl: string,
    sessionId: string,
    cwd: string,
    expectedPromptHash?: string,
): RecordedInteractionTrace | undefined {
    const events = parseTranscript(jsonl);
    if (!events) return undefined;
    const turn = findTurn(events, expectedPromptHash);
    if (!turn) return undefined;
    const user = turn[0];
    const prompt = getString(user.data ?? {}, "content");
    if (!prompt || !user.timestamp) return undefined;

    const accumulator: TraceAccumulator = {
        calls: new Map<string, RecordedToolCall>(),
        completedCalls: new Set<string>(),
        response: [],
    };
    let completedAt: string | undefined;

    for (const event of turn.slice(1)) {
        if (!recordEvent(event, accumulator)) return undefined;
        if (event.timestamp) completedAt = event.timestamp;
    }

    if (
        !completedAt ||
        accumulator.completedCalls.size !== accumulator.calls.size
    ) {
        return undefined;
    }

    return {
        schemaVersion: 1,
        sessionId,
        cwd,
        prompt: redactTraceValue(prompt) as string,
        response: redactTraceValue(accumulator.response.join("")) as string,
        startedAt: user.timestamp,
        completedAt,
        toolCalls: [...accumulator.calls.values()],
    };
}
