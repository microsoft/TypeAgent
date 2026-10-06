// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assertSessionSource, isSessionTimestamp } from "./sessionRecord.js";
import {
    sessionEventPolicy,
    retainsOutcome,
    type SessionEventPolicy,
} from "./sessionEventPolicy.js";
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

function projectEvidence(
    data: Record<string, unknown>,
    fields: readonly string[],
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of fields) {
        if (data[key] !== undefined) result[key] = structuredClone(data[key]);
    }
    return result;
}

function associations(data: Record<string, unknown>) {
    const result: Pick<
        NormalizedSessionEvent,
        | "parentToolCallId"
        | "parentAgentTaskId"
        | "messageId"
        | "originatingMessageId"
        | "interactionId"
        | "turnId"
        | "requestId"
    > = {};
    for (const key of [
        "parentToolCallId",
        "parentAgentTaskId",
        "messageId",
        "originatingMessageId",
        "interactionId",
        "turnId",
        "requestId",
    ] as const) {
        const value = optionalString(data[key]);
        if (value !== undefined) result[key] = value;
    }
    return result;
}

function attachments(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new MalformedEvent();
    return value.map((item: unknown) => {
        const source = object(item);
        string(source.type);
        // Keep references/selected text, never duplicate inline binary or extension payloads.
        return projectEvidence(source, [
            "type",
            "assetId",
            "byteLength",
            "displayName",
            "mimeType",
            "omittedReason",
            "path",
            "filePath",
            "lineRange",
            "selection",
            "text",
            "url",
            "repo",
            "ref",
            "base",
            "head",
            "revision",
            "number",
            "referenceType",
            "state",
            "title",
            "message",
            "oid",
            "name",
            "tagName",
            "jobId",
            "jobName",
            "workflowName",
            "conclusion",
            "description",
            "canvasId",
            "extensionId",
            "instanceId",
            "capturedAt",
        ]);
    });
}

function timestamp(value: unknown): string | undefined {
    const text = optionalString(value);
    if (text !== undefined && !isSessionTimestamp(text)) {
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
    // TODO: Map SDK structured patch fields when available; never infer from UI text.
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
    const evidence: Pick<
        Extract<NormalizedSessionEvent, { type: "tool-complete" }>,
        "detailedContent" | "contents" | "structuredContent" | "citableSources"
    > = {};
    for (const key of [
        "detailedContent",
        "contents",
        "structuredContent",
        "citableSources",
    ] as const) {
        if (result[key] !== undefined)
            evidence[key] = structuredClone(result[key]);
    }
    return {
        type: "tool-complete",
        toolCallId,
        success: data.success,
        ...(output !== undefined ? { output } : {}),
        ...(diff !== undefined ? { diff } : {}),
        ...evidence,
        ...(result.mcpMeta !== undefined
            ? { resultMcpMeta: structuredClone(result.mcpMeta) }
            : {}),
        ...(data.mcpMeta !== undefined
            ? { mcpMeta: structuredClone(data.mcpMeta) }
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
        "currentModel",
        "chosenModel",
        "fallbackModel",
        "followUpModel",
        "model",
    ]) {
        optionalString(data[key]);
    }
    timestamp(data.startTime);
    timestamp(data.resumeTime);
    if (data.finalSourceModel !== null) optionalString(data.finalSourceModel);
    if (type === "session.model_change") string(data.newModel);
}

function contentEvent(
    type: string,
    data: Record<string, unknown>,
    policy: SessionEventPolicy,
): EventContent | undefined {
    switch (policy) {
        case "message":
            return {
                type: "message",
                role:
                    type === "assistant.message"
                        ? "agent"
                        : type === "user.message"
                          ? "user"
                          : "system",
                text: string(data.content),
                ...(data.attachments !== undefined
                    ? { attachments: attachments(data.attachments) }
                    : {}),
                ...(data.toolRequests !== undefined
                    ? { toolRequests: structuredClone(data.toolRequests) }
                    : {}),
                ...(data.citations !== undefined
                    ? { citations: structuredClone(data.citations) }
                    : {}),
            };
        case "external-start":
            string(data.requestId);
        // Fall through: external requests retain native tool identity and arguments.
        case "tool-start":
            return {
                type: "tool-start",
                toolCallId: string(data.toolCallId),
                toolName: string(data.toolName),
                arguments: structuredClone(data.arguments),
                ...(type !== "tool.execution_start" ? { eventType: type } : {}),
                ...toolSource(data),
            };
        case "tool-complete":
            return completion(data);
        case "ignore":
            return undefined;
        default:
            if (policy.outcome && !retainsOutcome(policy.outcome, data))
                return undefined;
            validateSessionDetails(type, data);
            if (type === "external_tool.completed") string(data.requestId);
            return {
                type: "session",
                eventType: type,
                details: projectEvidence(data, ["model", ...policy.fields]),
            };
    }
}

function toolSource(data: Record<string, unknown>) {
    const result: Pick<
        Extract<NormalizedSessionEvent, { type: "tool-start" }>,
        "providerId" | "workingDirectory" | "mcpServerName" | "mcpToolName"
    > = {};
    for (const key of [
        "workingDirectory",
        "mcpServerName",
        "mcpToolName",
    ] as const) {
        const value = optionalString(data[key]);
        if (value !== undefined) result[key] = value;
    }
    if (data.providerId !== undefined)
        result.providerId =
            data.providerId === null ? null : string(data.providerId);
    return result;
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
        const policy = sessionEventPolicy(type);
        if (policy === "ignore") return;
        if (policy === undefined) {
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
        const parentId =
            payload.parentId == null ? undefined : string(payload.parentId);
        const content = contentEvent(type, data, policy);
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
                ...(parentId !== undefined ? { parentId } : {}),
                ...associations(data),
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
