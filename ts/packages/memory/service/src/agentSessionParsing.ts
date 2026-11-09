// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    AgentSessionEpisode,
    AgentSessionEvent,
    AgentSessionEventKind,
    AgentSessionImportRequest,
    AgentSessionParseResult,
} from "./agentSessionTypes.js";
import { redactRunbookText, redactRunbookValue } from "./runbookRedaction.js";
import { validateIsoTimestamp } from "./timestampValidation.js";

const maxChunkBytes = 512 * 1024;
const maxLineBytes = 64 * 1024;
const maxRecords = 1000;
const maxEventText = 12_000;
const maxEpisodeText = 16_000;
const identityFields = [
    "agentId",
    "parentAgentId",
    "taskId",
    "parentTaskId",
    "turnId",
    "callId",
] as const;
const eventFields = new Set([
    "schemaVersion",
    "id",
    "sessionId",
    "kind",
    "text",
    "role",
    ...identityFields,
    "timestamp",
    "outcome",
]);
const eventKinds = new Set<AgentSessionEventKind>([
    "objective",
    "message",
    "reasoning-summary",
    "delegation",
    "tool-call",
    "tool-result",
    "decision",
    "verification",
    "outcome",
    "compaction",
    "lifecycle",
]);
const roles = new Set(["user", "assistant", "tool", "system", "agent"]);
const outcomes = new Set(["success", "failure", "unknown"]);
const sdkFields = new Set([
    "id",
    "type",
    "timestamp",
    "data",
    "agentId",
    "parentId",
    "version",
    "ephemeral",
]);
const sdkKinds: Readonly<Record<string, AgentSessionEventKind>> = {
    "user.message": "message",
    "assistant.message": "message",
    "assistant.reasoning": "reasoning-summary",
    "assistant.turn_start": "lifecycle",
    "assistant.turn_end": "lifecycle",
    "session.start": "lifecycle",
    "session.idle": "lifecycle",
    "session.error": "lifecycle",
    "session.shutdown": "lifecycle",
    abort: "lifecycle",
    "tool.execution_start": "tool-call",
    "tool.execution_complete": "tool-result",
    "subagent.started": "delegation",
    "subagent.completed": "delegation",
    "session.compaction_complete": "compaction",
};
const hiddenReasoningFields = new Set([
    "reasoningOpaque",
    "encryptedContent",
    "reasoningBlocks",
    "reasoningText",
    "reasoningWireField",
]);

class InvalidRecord extends Error {}

function invalid(reason: string): never {
    throw new InvalidRecord(reason);
}

function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        invalid("Expected a JSON event object");
    }
    return value as Record<string, unknown>;
}

function knownFields(
    value: Record<string, unknown>,
    allowed: ReadonlySet<string>,
): void {
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        invalid("Unsupported event fields");
    }
}

function boundedString(value: unknown, max: number, multiline = false): string {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > max ||
        (multiline
            ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/
            : /[\u0000-\u001f\u007f-\u009f]/
        ).test(value) ||
        (!multiline && value !== value.trim()) ||
        Buffer.from(value, "utf8").toString("utf8") !== value
    ) {
        invalid("Invalid or oversized event text or identifier");
    }
    return value;
}

function identity(value: unknown): string {
    return redactRunbookText(boundedString(value, 200));
}

function timestamp(value: unknown): string {
    const text = boundedString(value, 80);
    try {
        validateIsoTimestamp("event timestamp", text);
    } catch {
        invalid("Invalid event timestamp");
    }
    return text;
}

function sortedValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortedValue);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, child]) => [
                    redactRunbookText(key),
                    sortedValue(child),
                ]),
        );
    }
    return value;
}

function redactedStrings(value: unknown, depth: number): unknown {
    if (depth > 30) invalid("Event content exceeds the nesting limit");
    if (typeof value === "string") return redactedText(value, depth + 1);
    if (Array.isArray(value)) {
        return value.map((child) => redactedStrings(child, depth + 1));
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
                redactRunbookText(key),
                redactedStrings(child, depth + 1),
            ]),
        );
    }
    return value;
}

function redactedText(value: string, depth = 0): string {
    const text = redactRunbookText(value);
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return text;
    }
    if (parsed === null || typeof parsed !== "object") return text;
    const redacted = redactedStrings(redactRunbookValue(parsed), depth + 1);
    return JSON.stringify(parsed) === JSON.stringify(redacted)
        ? text
        : JSON.stringify(sortedValue(redacted));
}

function eventText(value: unknown): string {
    if (typeof value === "string" && value.length > maxEventText) {
        invalid(
            "Event text exceeds 12000 UTF-16 characters; submit smaller events",
        );
    }
    const text = redactedText(boundedString(value, maxEventText, true));
    if (text.length > maxEventText) {
        invalid("Redacted event text exceeds 12000 UTF-16 characters");
    }
    return text;
}

function canonicalEvent(input: unknown, sessionId: string): AgentSessionEvent {
    const value = record(input);
    knownFields(value, eventFields);
    if (value.schemaVersion !== 1) invalid("Unsupported event schema version");
    if (value.sessionId !== sessionId) invalid("Event session ID mismatch");
    if (!eventKinds.has(value.kind as AgentSessionEventKind)) {
        invalid("Unsupported event kind");
    }
    const event: AgentSessionEvent = {
        schemaVersion: 1,
        id: identity(value.id),
        sessionId: identity(value.sessionId),
        kind: value.kind as AgentSessionEventKind,
        text: eventText(value.text),
        outcome: "unknown",
    };
    if (value.role !== undefined) {
        if (!roles.has(value.role as string)) invalid("Invalid event role");
        event.role = value.role as NonNullable<AgentSessionEvent["role"]>;
    }
    for (const field of identityFields) {
        if (value[field] !== undefined) event[field] = identity(value[field]);
    }
    if (value.timestamp !== undefined)
        event.timestamp = timestamp(value.timestamp);
    if (value.outcome !== undefined) {
        if (!outcomes.has(value.outcome as string))
            invalid("Invalid event outcome");
        event.outcome = value.outcome as NonNullable<
            AgentSessionEvent["outcome"]
        >;
    }
    return event;
}

function validateRequest(request: AgentSessionImportRequest): string[] {
    record(request);
    if (
        request.importType !== "agent-session-jsonl" &&
        request.importType !== "copilot-session-jsonl"
    ) {
        throw new Error("Unsupported agent session import type");
    }
    for (const value of [request.corpusId, request.sessionId]) {
        if (
            typeof value !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
        ) {
            throw new Error("Invalid corpus or session identifier");
        }
    }
    boundedString(request.idempotencyKey, 200);
    if (
        !Number.isSafeInteger(request.expectedCursor) ||
        request.expectedCursor < 0
    ) {
        throw new Error("Expected cursor must be a nonnegative safe integer");
    }
    if (request.final !== undefined && typeof request.final !== "boolean") {
        throw new Error("Invalid final flag");
    }
    for (const field of ["repository", "commit", "environment"] as const) {
        if (request[field] !== undefined) boundedString(request[field], 2000);
    }
    if (
        typeof request.jsonl !== "string" ||
        Buffer.byteLength(request.jsonl, "utf8") > maxChunkBytes
    ) {
        throw new Error("Agent session chunk exceeds 512 KiB or is not text");
    }
    const lines = request.jsonl.split("\n");
    const count = lines.filter((line) => line.trim()).length;
    if (count > maxRecords)
        throw new Error("Agent session chunk exceeds 1000 records");
    if (!count && request.final !== true) {
        throw new Error("Only a final agent session chunk may be empty");
    }
    return lines;
}

function sdkOutcome(
    type: string,
    data: Record<string, unknown>,
): NonNullable<AgentSessionEvent["outcome"]> {
    let outcome: NonNullable<AgentSessionEvent["outcome"]> = "unknown";
    if (data.success !== undefined) {
        if (typeof data.success !== "boolean")
            invalid("Invalid SDK success flag");
        outcome = data.success ? "success" : "failure";
    }
    if (data.status !== undefined) {
        const statuses: Record<
            string,
            NonNullable<AgentSessionEvent["outcome"]>
        > = {
            success: "success",
            succeeded: "success",
            completed: "unknown",
            failure: "failure",
            failed: "failure",
            error: "failure",
            cancelled: "failure",
            canceled: "failure",
            aborted: "failure",
            unknown: "unknown",
            running: "unknown",
            pending: "unknown",
            idle: "unknown",
        };
        if (
            typeof data.status !== "string" ||
            !Object.prototype.hasOwnProperty.call(statuses, data.status)
        ) {
            invalid("Invalid SDK status");
        }
        const status = statuses[data.status];
        if (outcome !== "unknown" && outcome !== status) {
            invalid("Conflicting SDK outcome fields");
        }
        outcome = status;
    }
    for (const field of ["cancelled", "aborted"] as const) {
        if (data[field] !== undefined && typeof data[field] !== "boolean") {
            invalid("Invalid SDK cancellation flag");
        }
        if (data[field] === true) outcome = "failure";
    }
    if (
        type === "session.error" ||
        type === "abort" ||
        (type === "session.shutdown" && data.shutdownType === "error")
    ) {
        outcome = "failure";
    }
    return outcome;
}

function withoutReasoning(
    value: unknown,
    report: () => void,
    depth = 0,
): unknown {
    if (depth > 30) invalid("SDK data exceeds the nesting limit");
    if (Array.isArray(value)) {
        return value.map((child) => withoutReasoning(child, report, depth + 1));
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).flatMap(([key, child]) => {
                if (hiddenReasoningFields.has(key)) {
                    report();
                    return [];
                }
                return [[key, withoutReasoning(child, report, depth + 1)]];
            }),
        );
    }
    return value;
}

function sdkEnvelope(input: unknown, sessionId: string) {
    const value = record(input);
    knownFields(value, sdkFields);
    if (value.version !== undefined && value.version !== 1) {
        invalid("Unsupported SDK event version");
    }
    if (
        typeof value.type !== "string" ||
        !Object.prototype.hasOwnProperty.call(sdkKinds, value.type)
    ) {
        invalid("Unsupported SDK event type");
    }
    const type = value.type;
    const data = record(value.data);
    if (data.version !== undefined && data.version !== 1) {
        invalid("Unsupported SDK data version");
    }
    if (data.sessionId !== undefined && data.sessionId !== sessionId) {
        invalid("Event session ID mismatch");
    }
    if (value.ephemeral !== undefined && typeof value.ephemeral !== "boolean") {
        invalid("Invalid SDK ephemeral flag");
    }
    if (value.parentId !== undefined && value.parentId !== null) {
        identity(value.parentId);
    }
    return { value, type, data };
}

function sdkRelationships(
    event: AgentSessionEvent,
    value: Record<string, unknown>,
    data: Record<string, unknown>,
    type: string,
) {
    if (value.agentId !== undefined) event.agentId = identity(value.agentId);
    for (const field of identityFields) {
        if (data[field] !== undefined) event[field] = identity(data[field]);
    }
    if (data.toolCallId !== undefined) event.callId = identity(data.toolCallId);
    if (data.parentToolCallId !== undefined) identity(data.parentToolCallId);
    if (data.parentAgentTaskId !== undefined) {
        event.parentTaskId = identity(data.parentAgentTaskId);
    }
    if (type.startsWith("subagent.")) {
        if (data.parentId !== undefined)
            event.parentTaskId = identity(data.parentId);
        event.role = "agent";
    }
    if (type.startsWith("tool.") && !event.callId) {
        invalid("SDK tool event requires a call ID");
    }
}

function sdkSafeData(
    type: string,
    data: Record<string, unknown>,
    report: (reason: string) => void,
) {
    if (type === "user.message" || type === "assistant.message") {
        boundedString(data.content, maxEventText, true);
    }
    if (type === "assistant.reasoning") {
        if (typeof data.summary !== "string" || !data.summary.trim()) {
            invalid(
                "Opaque assistant reasoning omitted; an explicit summary is required",
            );
        }
        boundedString(data.summary, maxEventText, true);
    }
    let omitted = false;
    const safeData = record(
        withoutReasoning(data, () => {
            omitted = true;
        }),
    );
    if (type === "assistant.reasoning") {
        for (const key of Object.keys(safeData)) {
            if (key !== "summary" && key !== "reasoningId") {
                delete safeData[key];
                omitted = true;
            }
        }
    }
    if (omitted) report("Opaque assistant reasoning fields omitted");
    return safeData;
}

function sdkEvent(
    input: unknown,
    sessionId: string,
    report: (reason: string) => void,
): AgentSessionEvent {
    const { value, type, data } = sdkEnvelope(input, sessionId);
    const event: AgentSessionEvent = {
        schemaVersion: 1,
        id: identity(value.id),
        sessionId: identity(sessionId),
        kind: sdkKinds[type],
        text: "",
        timestamp: timestamp(value.timestamp),
        outcome: sdkOutcome(type, data),
        role: type.startsWith("assistant.")
            ? "assistant"
            : type === "user.message"
              ? "user"
              : type.startsWith("tool.")
                ? "tool"
                : "system",
    };
    sdkRelationships(event, value, data, type);
    const safeData = sdkSafeData(type, data, report);
    // SDK result.content is the model-visible text; do not conflate it with arguments.
    event.text = JSON.stringify(
        sortedValue(
            redactedStrings(
                redactRunbookValue({
                    sourceType: type,
                    ...(value.parentId !== undefined
                        ? { parentId: value.parentId }
                        : {}),
                    data: safeData,
                }),
                0,
            ),
        ),
    );
    if (event.text.length > maxEventText) {
        invalid(
            "Event text exceeds 12000 UTF-16 characters; submit smaller events",
        );
    }
    return event;
}

/** Digests cover only validated, redacted canonical content, in fixed field order. */
export function agentSessionEventDigest(event: AgentSessionEvent): string {
    const safe = canonicalEvent(event, event.sessionId);
    return createHash("sha256").update(JSON.stringify(safe)).digest("hex");
}

/** Parse one bounded chunk, never a whole-session log or a partial JSON record. */
export function parseAgentSessionChunk(
    request: AgentSessionImportRequest,
): AgentSessionParseResult {
    const lines = validateRequest(request);
    const result: AgentSessionParseResult = {
        events: [],
        records: 0,
        duplicates: 0,
        losses: [],
    };
    const identities = new Map<string, string>();
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index].replace(/\r$/, "");
        if (!line.trim()) continue;
        result.records++;
        let event: AgentSessionEvent;
        const losses: string[] = [];
        try {
            if (Buffer.byteLength(line, "utf8") > maxLineBytes) {
                invalid("JSONL record exceeds 64 KiB");
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(line);
            } catch {
                invalid("Malformed or partial JSONL record");
            }
            event =
                request.importType === "agent-session-jsonl"
                    ? canonicalEvent(parsed, request.sessionId)
                    : sdkEvent(parsed, request.sessionId, (reason) =>
                          losses.push(reason),
                      );
        } catch (error) {
            result.losses.push({
                line: index + 1,
                reason:
                    error instanceof InvalidRecord
                        ? error.message
                        : "Record could not be parsed safely",
            });
            continue;
        }
        const digest = agentSessionEventDigest(event);
        const previous = identities.get(event.id);
        if (previous !== undefined && previous !== digest) {
            throw new Error(
                "Conflicting duplicate agent session event identity",
            );
        }
        if (previous === digest) {
            result.duplicates++;
        } else {
            identities.set(event.id, digest);
            result.events.push(event);
        }
        for (const reason of losses)
            result.losses.push({ line: index + 1, reason });
    }
    return result;
}

/** Group explicit tasks/agents without inferring causality from adjacent events. */
export function buildAgentSessionEpisodes(
    events: AgentSessionEvent[],
): AgentSessionEpisode[] {
    const groups = new Map<
        string,
        Array<{ event: AgentSessionEvent; order: number }>
    >();
    const identities = new Map<string, string>();
    for (const [order, input] of events.entries()) {
        const event = canonicalEvent(input, input.sessionId);
        const identityKey = JSON.stringify([event.sessionId, event.id]);
        const digest = agentSessionEventDigest(event);
        const previous = identities.get(identityKey);
        if (previous !== undefined) {
            if (previous !== digest) {
                throw new Error(
                    "Conflicting duplicate agent session event identity",
                );
            }
            continue;
        }
        identities.set(identityKey, digest);
        const key = JSON.stringify([
            event.sessionId,
            event.agentId ?? null,
            event.taskId ?? null,
        ]);
        const group = groups.get(key) ?? [];
        group.push({ event, order });
        groups.set(key, group);
    }
    const episodes: Array<{ episode: AgentSessionEpisode; order: number }> = [];
    for (const group of groups.values()) {
        let episode: AgentSessionEpisode | undefined;
        for (const { event, order } of group) {
            const { text, ...metadata } = event;
            const header = `${JSON.stringify(metadata)}\n`;
            const passage = header + text;
            if (passage.length > maxEpisodeText) {
                throw new Error(
                    "Event cannot fit a bounded agent session episode",
                );
            }
            if (
                !episode ||
                episode.text.length + 2 + passage.length > maxEpisodeText
            ) {
                episode = { episodeId: "", events: [], text: "", spans: [] };
                episodes.push({ episode, order });
            }
            if (episode.events.length) episode.text += "\n\n";
            const start = episode.text.length + header.length;
            episode.text += passage;
            episode.events.push(event);
            episode.spans.push({
                eventId: event.id,
                start,
                end: start + text.length,
            });
        }
    }
    return episodes
        .sort((a, b) => a.order - b.order)
        .map(({ episode }) => {
            episode.episodeId = createHash("sha256")
                .update(
                    JSON.stringify(episode.events.map(agentSessionEventDigest)),
                )
                .digest("hex");
            return episode;
        });
}
