// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Severity level attached to a Structured Logger event. The set is
 * deliberately small (`info`, `warning`, `error`) so it maps cleanly onto
 * the OTel Logs severity buckets without inference from the event name or
 * payload. Callers omit the parameter for the default `info` case.
 */
export type LogEventSeverity = "info" | "warning" | "error";

export type LogEvent = {
    eventName: string;
    timestamp: string;
    event: LogEventData;
    /**
     * Optional for compatibility with events constructed directly for a
     * sink. A missing value means `info`. `MultiSinkLogger` materializes
     * that default on the event it sends to its sinks.
     */
    severity?: LogEventSeverity;
};

export interface LogEventData {
    [key: string]: any;
}
export interface Logger {
    /**
     * Record a Structured Logger event.
     *
     * `severity` is optional and defaults to `info` at every sink that
     * carries a severity concept. Sinks must not infer severity from the
     * event name or from the payload; the caller is the only signal.
     */
    logEvent<T extends LogEventData>(
        eventName: string,
        entry: T,
        severity?: LogEventSeverity,
    ): void;
}

export interface LoggerSink {
    /**
     * Consume one event. The outer `LogEvent` wrapper is sink-local, but
     * its caller-owned `event` payload may be shared with sibling sinks.
     * Treat the payload as read-only.
     */
    logEvent(event: LogEvent): void;
}

export class ChildLogger implements Logger {
    constructor(
        private readonly parent: Logger,
        private readonly name?: string,
        private readonly commonProperties?: LogEventData,
    ) {}
    public logEvent<T extends LogEventData>(
        eventName: string,
        entry: T,
        severity: LogEventSeverity = "info",
    ) {
        const event: LogEventData = {};
        if (this.commonProperties) {
            for (const [key, value] of Object.entries(this.commonProperties)) {
                event[key] = typeof value === "function" ? value() : value;
            }
        }
        Object.assign(event, entry);
        const name = this.name ? `${this.name}:${eventName}` : eventName;
        this.parent.logEvent(name, event, severity);
    }
}

export class MultiSinkLogger implements Logger {
    constructor(private readonly sinks: LoggerSink[]) {}
    public addSink(sink: LoggerSink) {
        this.sinks.push(sink);
    }
    public logEvent<T extends LogEventData>(
        eventName: string,
        event: T,
        severity: LogEventSeverity = "info",
    ) {
        for (const sink of this.sinks) {
            // Preserve the existing per-sink wrapper isolation. A sink may
            // mutate its LogEvent wrapper without changing what later sinks
            // observe; the caller-owned payload remains shared as before.
            sink.logEvent({
                eventName,
                timestamp: new Date().toISOString(),
                event,
                severity,
            });
        }
    }
}

/**
 * Cosmos DB abstractions to avoid direct dependency on @azure/cosmos and @azure/identity
 */

export interface CosmosBulkOperationResponse {
    statusCode?: number;
}

export interface CosmosBulkOperationResult {
    response?: CosmosBulkOperationResponse;
}

export interface CosmosPartitionKey {
    toString(): string;
    length: number;
}

export interface CosmosBulkOperation {
    operationType: "Create";
    partitionKey: CosmosPartitionKey;
    resourceBody: Record<string, unknown>;
}

export interface CosmosContainerClient {
    executeBulkOperations(
        operations: CosmosBulkOperation[],
    ): Promise<CosmosBulkOperationResult[]>;
}

export type CosmosContainerClientFactory = (
    endpoint: string,
    databaseName: string,
    containerName: string,
) => Promise<CosmosContainerClient>;

export interface CosmosPartitionKeyBuilder {
    addValue(value: string): CosmosPartitionKeyBuilder;
    build(): CosmosPartitionKey;
}
