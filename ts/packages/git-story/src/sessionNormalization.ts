// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import type {
    CapturedSessionRecord,
    CapturedSessionUpdates,
    SessionCaptureDiagnostic,
    SessionCaptureSource,
} from "./sessionCapture.js";
import type {
    NormalizedSessionEvent,
    SessionCaptureCheckpoint,
    SessionWatchRequest,
} from "./sessionWatcher.js";

export type SessionNormalizationDiagnostic =
    | SessionCaptureDiagnostic
    | {
          code: "unsupported-event" | "malformed-event";
          source: SessionCaptureSource;
      };

export type NormalizedSessionBatch = {
    events: NormalizedSessionEvent[];
    diagnostics: SessionNormalizationDiagnostic[];
    generation: string;
    nextCheckpoint: SessionCaptureCheckpoint;
    // Includes valid timestamps on unsupported and explicitly ignored records.
    lastEventTimestamp?: string;
};

const sessionEvents = new Set([
    "session.start",
    "session.resume",
    "session.model_change",
    "session.info",
    "session.warning",
    "session.error",
    "session.idle",
    "session.shutdown",
    "session.context_changed",
    "session.title_changed",
    "session.task_complete",
    "session.handoff",
    "session.truncation",
    "session.compaction_complete",
    "assistant.usage",
    "subagent.started",
    "subagent.completed",
    "subagent.failed",
]);

// Deltas and progress are not authoritative completed messages or tool results.
const ignoredEvents = new Set([
    "assistant.message_delta",
    "assistant.message_start",
    "assistant.reasoning_delta",
    "assistant.streaming_delta",
    "assistant.tool_call_delta",
    "assistant.turn_start",
    "assistant.turn_end",
    "assistant.idle",
    "tool.execution_partial_result",
    "tool.execution_progress",
]);

class MalformedEvent extends Error {}

type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;
type EventContent = WithoutId<NormalizedSessionEvent>;

function object(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new MalformedEvent();
    }
    return value as Record<string, unknown>;
}

function string(value: unknown): string {
    if (typeof value !== "string") throw new MalformedEvent();
    return value;
}

function optionalString(value: unknown): string | undefined {
    return value === undefined ? undefined : string(value);
}

function timestamp(value: unknown): string | undefined {
    const text = optionalString(value);
    if (
        text !== undefined &&
        (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ||
            !Number.isFinite(Date.parse(text)))
    ) {
        throw new MalformedEvent();
    }
    return text;
}

export function latestTimestamp(
    previous: string | undefined,
    next: string | undefined,
): string | undefined {
    return next !== undefined &&
        (previous === undefined || Date.parse(next) > Date.parse(previous))
        ? next
        : previous;
}

function reportedDiff(result: Record<string, unknown>): string | undefined {
    if (result.diff !== undefined) return string(result.diff);
    const detail = result.detailedContent;
    if (
        typeof detail === "object" &&
        detail !== null &&
        !Array.isArray(detail) &&
        "diff" in detail &&
        typeof detail.diff === "string"
    ) {
        return detail.diff;
    }
    if (
        typeof detail === "string" &&
        /^(?:diff --git |--- )/.test(detail) &&
        /^--- [^\r\n]+\r?\n\+\+\+ [^\r\n]+\r?\n@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(
            detail,
        )
    ) {
        return detail;
    }
    return undefined;
}

function completion(
    data: Record<string, unknown>,
): Omit<Extract<NormalizedSessionEvent, { type: "tool-complete" }>, "id"> {
    const toolCallId = string(data.toolCallId);
    if (typeof data.success !== "boolean") throw new MalformedEvent();
    const result = data.result === undefined ? {} : object(data.result);
    const output = optionalString(result.content);
    const diff = reportedDiff(result);
    return {
        type: "tool-complete",
        toolCallId,
        success: data.success,
        ...(output !== undefined ? { output } : {}),
        ...(diff !== undefined ? { diff } : {}),
        ...(result.detailedContent !== undefined
            ? { detailedContent: structuredClone(result.detailedContent) }
            : {}),
        ...(data.error !== undefined
            ? { error: structuredClone(object(data.error)) }
            : {}),
    };
}

function validateSessionDetails(
    type: string,
    data: Record<string, unknown>,
): void {
    for (const key of [
        "clientName",
        "producer",
        "parentSessionId",
        "detachedFromSpawningParentSessionId",
        "selectedModel",
        "previousModel",
        "model",
    ]) {
        optionalString(data[key]);
    }
    timestamp(data.startTime);
    timestamp(data.resumeTime);
    if (type === "session.model_change") string(data.newModel);
}

function contentEvent(
    type: string,
    data: Record<string, unknown>,
): EventContent | undefined {
    switch (type) {
        case "user.message":
        case "assistant.message":
        case "system.message":
            return {
                type: "message",
                role:
                    type === "assistant.message"
                        ? "agent"
                        : type === "user.message"
                          ? "user"
                          : "system",
                text: string(data.content),
            };
        case "tool.execution_start":
            return {
                type: "tool-start",
                toolCallId: string(data.toolCallId),
                toolName: string(data.toolName),
                arguments: structuredClone(data.arguments),
            };
        case "tool.execution_complete":
            return completion(data);
        default:
            if (!sessionEvents.has(type)) return undefined;
            validateSessionDetails(type, data);
            return {
                type: "session",
                eventType: type,
                details: structuredClone(data),
            };
    }
}

function normalizeRecord(
    record: CapturedSessionRecord,
    batch: NormalizedSessionBatch,
): void {
    try {
        const payload = object(record.payload);
        const type = string(payload.type);
        const eventTimestamp = timestamp(payload.timestamp);
        const latest = latestTimestamp(
            batch.lastEventTimestamp,
            eventTimestamp,
        );
        if (latest !== undefined) batch.lastEventTimestamp = latest;
        if (ignoredEvents.has(type)) return;
        const supported =
            sessionEvents.has(type) ||
            [
                "user.message",
                "assistant.message",
                "system.message",
                "tool.execution_start",
                "tool.execution_complete",
            ].includes(type);
        if (!supported) {
            batch.diagnostics.push({
                code: "unsupported-event",
                source: record.source,
            });
            return;
        }
        const data = object(payload.data);
        const model =
            optionalString(data.model) ?? optionalString(payload.model);
        const agentId = optionalString(payload.agentId);
        const content = contentEvent(type, data);
        if (content) {
            batch.events.push({
                ...content,
                id: record.id,
                ...(record.sourceEventId !== undefined
                    ? { sourceEventId: record.sourceEventId }
                    : {}),
                ...(eventTimestamp !== undefined
                    ? { timestamp: eventTimestamp }
                    : {}),
                ...(model !== undefined ? { model } : {}),
                ...(agentId !== undefined ? { agentId } : {}),
            });
        }
    } catch (error) {
        if (!(error instanceof MalformedEvent)) throw error;
        batch.diagnostics.push({
            code: "malformed-event",
            source: record.source,
        });
    }
}

export function assertSessionSource(
    request: SessionWatchRequest,
    source: Pick<SessionCaptureSource, "sessionId" | "transcriptPath">,
): void {
    if (
        source.sessionId !== request.sessionId ||
        source.transcriptPath !== path.normalize(request.transcriptPath)
    ) {
        throw new Error("Session source does not match registration");
    }
}

export function normalizeSessionEvents(
    request: SessionWatchRequest,
    updates: CapturedSessionUpdates,
): NormalizedSessionBatch {
    assertSessionSource(request, updates.nextCheckpoint);
    for (const { source } of [...updates.records, ...updates.diagnostics]) {
        assertSessionSource(request, source);
        if (source.generation !== updates.generation) {
            throw new Error("Session batch contains mixed generations");
        }
    }
    const batch: NormalizedSessionBatch = {
        events: [],
        diagnostics: structuredClone(updates.diagnostics),
        generation: updates.generation,
        nextCheckpoint: { ...updates.nextCheckpoint },
    };
    for (const record of updates.records) {
        if (
            record.sourceEventId !== undefined &&
            record.id !== record.sourceEventId
        ) {
            throw new Error("Captured event ID does not match native ID");
        }
        normalizeRecord(record, batch);
    }
    return batch;
}
