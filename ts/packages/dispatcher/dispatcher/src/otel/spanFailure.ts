// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpanStatusCode, type Span } from "@opentelemetry/api";
import { otel } from "@typeagent/telemetry";

/**
 * One cancellation decision for every phase span, so a span and the structured
 * `*:completed` event recorded next to it cannot disagree about the same
 * failure.
 *
 * The decision itself is `otel.isTelemetryCancellation`, which the structured
 * events and the LLM wrapper already use. It walks the `cause` chain, so a
 * cancellation wrapped in a phase-level error is still a cancellation - the
 * `error.name === "AbortError"` check each span wrapper used to do saw only the
 * outermost value and reported those as ordinary failures.
 */

/**
 * Signals whose aborted state means "this failure was a cancellation",
 * evaluated when the failure is recorded rather than when the span opened.
 *
 * This is the "signal-only" case: the work was torn down, so what surfaces is
 * whatever the provider or the phase happened to throw at that moment (a
 * socket error, a timeout, a partial-parse failure), and nothing in that value
 * says it was cancelled. The call site knows because it holds the signal.
 */
export type CancellationSignals = readonly (AbortSignal | undefined)[];

export function anyCancellationSignalAborted(
    signals: CancellationSignals | undefined,
): boolean {
    return signals?.some((signal) => signal?.aborted === true) === true;
}

/**
 * How one phase names a real failure on its span: the exception type and the
 * status message. Both are fixed strings chosen by the phase - never the
 * original message, which can carry user input.
 */
export interface SpanFailureNames {
    readonly errorName: string;
    readonly failureMessage: string;
}

/**
 * A cancellation is reported the same way by every phase, so it is stated once
 * here rather than repeated per span. The status code stays `ERROR` (the
 * operation did not complete, and the LLM and request spans have always
 * recorded it that way); what marks it as a cancellation rather than a phase
 * failure is the `AbortError` name and the `cancelled` message, which is
 * exactly what the correlated `*:completed` event reports as its `status`.
 */
const CANCELLED_NAMES: SpanFailureNames = Object.freeze({
    errorName: "AbortError",
    failureMessage: "cancelled",
});

/**
 * Record an exception that escaped a phase body onto that phase's span.
 *
 * Nothing derived from the thrown value's own message or stack is recorded:
 * only the fixed names above, chosen by the classification.
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
