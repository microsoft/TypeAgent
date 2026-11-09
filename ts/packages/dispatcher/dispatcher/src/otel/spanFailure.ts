// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpanStatusCode, type Span } from "@opentelemetry/api";
import { otel } from "@typeagent/telemetry";

/**
 * One cancellation decision for every phase span, so a span and the structured
 * `*:completed` event recorded next to it cannot disagree about the same
 * failure.
 */

/**
 * Signals whose aborted state means "this failure was a cancellation",
 * evaluated when the failure is recorded. Needed because a torn-down phase
 * surfaces whatever it happened to throw at that moment (a socket error, a
 * partial-parse failure), which says nothing about having been cancelled.
 */
export type CancellationSignals = readonly (AbortSignal | undefined)[];

export function anyCancellationSignalAborted(
    signals: CancellationSignals | undefined,
): boolean {
    return signals?.some((signal) => signal?.aborted === true) === true;
}

/**
 * How one phase names a real failure on its span. Both are fixed strings
 * chosen by the phase - never the original message, which can carry user input.
 */
export interface SpanFailureNames {
    readonly errorName: string;
    readonly failureMessage: string;
}

/**
 * The status code stays `ERROR` (the operation did not complete); the
 * `AbortError` name and `cancelled` message are what mark it as a
 * cancellation, matching the correlated `*:completed` event's `status`.
 */
const CANCELLED_NAMES: SpanFailureNames = Object.freeze({
    errorName: "AbortError",
    failureMessage: "cancelled",
});

/**
 * Record an exception that escaped a phase body onto that phase's span. Only
 * the fixed names above are recorded, never the thrown value's message or
 * stack.
 */
export function recordSpanFailure(
    span: Span,
    error: unknown,
    failure: SpanFailureNames,
    cancellationSignals?: CancellationSignals,
): void {
    const { errorName, failureMessage } = otel.isTelemetryCancellation(
        error,
        anyCancellationSignalAborted(cancellationSignals),
    )
        ? CANCELLED_NAMES
        : failure;
    span.recordException({ name: errorName, message: failureMessage });
    span.setStatus({ code: SpanStatusCode.ERROR, message: failureMessage });
}
