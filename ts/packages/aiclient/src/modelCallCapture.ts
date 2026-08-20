// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One LLM call captured at the translate choke point: the full prompt sent and
 * the raw provider response. Used by benchmarks to write per-row trajectories.
 */
export interface ModelCallRecord {
    name: string;
    request: unknown;
    response: unknown;
    usage?: unknown;
    atMs: number;
    durationMs: number;
}

export type ModelCallSink = (record: ModelCallRecord) => void;

// AsyncLocalStorage (not OpenTelemetry context) so propagation works even when
// no otel ContextManager is registered, e.g. headless benchmark runs.
const modelCallSinkStore = new AsyncLocalStorage<ModelCallSink | undefined>();

/** The sink active for the current async context, if any. */
export function getModelCallSink(): ModelCallSink | undefined {
    return modelCallSinkStore.getStore();
}

/** Run `body` with `sink` active for every model call it triggers. */
export function withModelCallSink<T>(
    sink: ModelCallSink | undefined,
    body: () => T,
): T {
    return modelCallSinkStore.run(sink, body);
}
