// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One non-streaming JSON translation call captured at ChatModel.complete.
 * Used by benchmarks to write the model input, result, usage, and timing.
 */
export interface ModelCallRecord {
    name: string;
    request: unknown;
    response: unknown;
    usage?: unknown;
    atMs: number;
    durationMs: number;
}

/** Receives each record synchronously before translation returns. */
export type ModelCallSink = (record: ModelCallRecord) => void;

// AsyncLocalStorage (not OpenTelemetry context) so propagation works even when
// no otel ContextManager is registered, e.g. headless benchmark runs.
const modelCallSinkStore = new AsyncLocalStorage<ModelCallSink | undefined>();

/** The sink active for the current async context, if any. */
export function getModelCallSink(): ModelCallSink | undefined {
    return modelCallSinkStore.getStore();
}

/** Run `body` with `sink` active for its non-streaming JSON model calls. */
export function withModelCallSink<T>(
    sink: ModelCallSink | undefined,
    body: () => T,
): T {
    return modelCallSinkStore.run(sink, body);
}
