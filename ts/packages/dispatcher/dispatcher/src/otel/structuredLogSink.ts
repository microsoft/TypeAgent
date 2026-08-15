// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createOtelLoggerSink,
    type LogEvent,
    type LoggerSink,
} from "@typeagent/telemetry";

const SAFE_STRING_FIELDS = [
    "sessionId",
    "activationId",
    "traceId",
    "requestId",
    "connectionId",
    "appAgentName",
    "schemaName",
    "actionName",
    "kind",
    "strategy",
    "classifier",
    "provider",
    "model",
    "operation",
    "state",
    "status",
    "reason",
    "phase",
    "position",
    "path",
] as const;

const SAFE_NUMBER_FIELDS = [
    "timestamp",
    "elapsedMs",
    "waitMs",
    "runMs",
    "totalMs",
    "queuedAhead",
    "queueDepth",
    "depth",
    "count",
    "attachmentCount",
    "actionIndex",
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedTokens",
] as const;

const SAFE_BOOLEAN_FIELDS = [
    "success",
    "running",
    "developerMode",
    "includeContext",
    "cancelled",
    "streaming",
] as const;

const SAFE_STRING_ARRAY_FIELDS = [
    "schemaNames",
    "actionNames",
    "command",
] as const;
const MAX_ARRAY_LENGTH = 64;
const MAX_STRING_LENGTH = 256;

export function createDispatcherOtelLoggerSink(
    sink: LoggerSink = createOtelLoggerSink(),
): LoggerSink {
    return {
        logEvent(event: LogEvent): void {
            sink.logEvent({
                ...event,
                event: projectDispatcherLogEvent(event.event),
            });
        },
    };
}

function projectDispatcherLogEvent(
    source: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    const projected: Record<string, unknown> = {};

    copyFields(source, projected, SAFE_STRING_FIELDS, isBoundedString);
    copyFields(
        source,
        projected,
        SAFE_NUMBER_FIELDS,
        (value): value is number =>
            typeof value === "number" && Number.isFinite(value),
    );
    copyFields(
        source,
        projected,
        SAFE_BOOLEAN_FIELDS,
        (value): value is boolean => typeof value === "boolean",
    );
    copyFields(
        source,
        projected,
        SAFE_STRING_ARRAY_FIELDS,
        isBoundedStringArray,
    );

    return projected;
}

function copyFields(
    source: Readonly<Record<string, unknown>>,
    target: Record<string, unknown>,
    fields: readonly string[],
    isSafe: (value: unknown) => boolean,
): void {
    for (const field of fields) {
        const value = source[field];
        if (isSafe(value)) {
            target[field] = value;
        }
    }
}

function isBoundedString(value: unknown): value is string {
    return typeof value === "string" && value.length <= MAX_STRING_LENGTH;
}

function isBoundedStringArray(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.length <= MAX_ARRAY_LENGTH &&
        value.every(isBoundedString)
    );
}
