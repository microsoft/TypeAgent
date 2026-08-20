// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Context } from "@opentelemetry/api";
import type { InstrumentationScope } from "@opentelemetry/core";
import type { SeverityNumber } from "@opentelemetry/api-logs";
import type {
    ForceFlushOptions,
    LogRecordProcessor,
    SdkLogRecord,
} from "@opentelemetry/sdk-logs";
import { getLocalTelemetryState } from "./localTelemetryState.js";
import {
    debugClassAllowedByProfile,
    readDebugClass,
    type DebugLogClass,
} from "./debugClass.js";

/**
 * Applies process-local JSONL policy when a record is emitted, before an
 * asynchronous batch processor can observe later @log state changes.
 */
export class LocalLogRecordProcessor implements LogRecordProcessor {
    public constructor(private readonly delegate: LogRecordProcessor) {}

    public onEmit(logRecord: SdkLogRecord, context?: Context): void {
        if (
            shouldEmitLocalRecord(
                logRecord.eventName,
                logRecord.body,
                logRecord.attributes,
            )
        ) {
            this.delegate.onEmit(logRecord, context);
        }
    }

    public enabled(options: {
        context: Context;
        instrumentationScope: InstrumentationScope;
        severityNumber?: SeverityNumber;
        eventName?: string;
    }): boolean {
        return (
            couldEmitLocalRecord(options.eventName) &&
            (this.delegate.enabled?.(options) ?? true)
        );
    }

    public forceFlush(options?: ForceFlushOptions): Promise<void> {
        return this.delegate.forceFlush(options);
    }

    public shutdown(): Promise<void> {
        return this.delegate.shutdown();
    }
}

/**
 * Whether a record with the given event name could ever be emitted under the
 * current profile, without inspecting per-record attributes. Used by
 * `enabled()` to short-circuit record construction. `debug` records are
 * governed by class in `onEmit`, so this only rejects the profiles that surface
 * no debug at all (`off`, `focused`); structured events stay permissive here.
 */
function couldEmitLocalRecord(eventName: string | undefined): boolean {
    const snapshot = getLocalTelemetryState().getSnapshot();
    if (snapshot.profile === "off" || eventName === "dispatcher:command") {
        return false;
    }
    if (eventName === "debug") {
        return (
            snapshot.profile === "diagnostic" || snapshot.profile === "verbose"
        );
    }
    return true;
}

function shouldEmitLocalRecord(
    eventName: string | undefined,
    body?: unknown,
    attributes?: Readonly<Record<string, unknown>>,
): boolean {
    const snapshot = getLocalTelemetryState().getSnapshot();
    if (snapshot.profile === "off" || eventName === "dispatcher:command") {
        return false;
    }
    if (eventName === "debug") {
        const cls: DebugLogClass = readDebugClass(attributes);
        return debugClassAllowedByProfile(snapshot.profile, cls);
    }
    return !shouldSuppressFocusedBackgroundLlmEvent(
        snapshot.profile,
        eventName,
        body,
    );
}

function shouldSuppressFocusedBackgroundLlmEvent(
    profile: string,
    eventName: string | undefined,
    body: unknown,
): boolean {
    if (
        profile !== "focused" ||
        (eventName !== "aiclient:llm:started" &&
            eventName !== "aiclient:llm:completed")
    ) {
        return false;
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return false;
    }
    const data = body as Record<string, unknown>;
    return (
        data.scope === "background" &&
        (eventName === "aiclient:llm:started" || data.success === true)
    );
}
