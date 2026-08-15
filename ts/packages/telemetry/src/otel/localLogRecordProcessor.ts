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

/**
 * Applies process-local JSONL policy when a record is emitted, before an
 * asynchronous batch processor can observe later @log state changes.
 */
export class LocalLogRecordProcessor implements LogRecordProcessor {
    public constructor(private readonly delegate: LogRecordProcessor) {}

    public onEmit(logRecord: SdkLogRecord, context?: Context): void {
        if (shouldEmitLocalRecord(logRecord.eventName)) {
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
            shouldEmitLocalRecord(options.eventName) &&
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

function shouldEmitLocalRecord(eventName: string | undefined): boolean {
    const snapshot = getLocalTelemetryState().getSnapshot();
    return (
        snapshot.profile !== "off" &&
        (eventName !== "debug" || snapshot.debugCopy)
    );
}
