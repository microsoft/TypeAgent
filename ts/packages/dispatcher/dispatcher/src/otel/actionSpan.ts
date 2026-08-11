// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SpanStatusCode,
    trace,
    type Span,
    type Tracer,
} from "@opentelemetry/api";
import { otel } from "@typeagent/telemetry";

export const ACTION_SPAN_EVENTS = Object.freeze({
    RESULT_ERROR: "action.result.error",
    SETUP_FAILED: "action.setup.failed",
} as const);

export type ActionSetupFailureKind = "handler_missing" | "agent_not_ready";

export function recordActionSetupFailure(
    span: Span,
    kind: ActionSetupFailureKind,
): void {
    span.addEvent(ACTION_SPAN_EVENTS.SETUP_FAILED, { failure_kind: kind });
    span.setStatus({ code: SpanStatusCode.ERROR, message: kind });
}

export function recordActionResultError(span: Span): void {
    span.addEvent(ACTION_SPAN_EVENTS.RESULT_ERROR, {
        failure_kind: "result_error",
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: "result_error" });
}

export function recordActionHandlerException(span: Span): void {
    span.recordException({
        name: "ActionHandlerError",
        message: "action handler failed",
    });
    span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "action handler failed",
    });
}

export function recordActionFlowException(span: Span): void {
    span.recordException({
        name: "ActionFlowError",
        message: "action flow failed",
    });
    span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "action flow failed",
    });
}

/**
 * Run an action-execution body inside a `typeagent.action` span. The span
 * becomes a child of whatever span is active on the current OTel context
 * (typically `typeagent.request`, or another `typeagent.action` when a
 * flow step dispatches a sub-action). It is ended exactly once regardless
 * of whether the body returns normally, throws, or is cancelled.
 *
 * Exceptions that escape the body are recorded with stable, privacy-safe
 * classifications matching the request/translation span conventions.
 */
export async function wrapActionSpan<T>(
    attributes: otel.TypeAgentSpanAttributes,
    body: (span: Span) => Promise<T>,
): Promise<T> {
    const tracer: Tracer = trace.getTracer(
        otel.INSTRUMENTATION_SCOPE_NAME,
        otel.INSTRUMENTATION_SCOPE_VERSION,
    );
    return tracer.startActiveSpan(
        otel.TYPEAGENT_SPAN_NAMES.ACTION,
        async (span) => {
            otel.setTypeAgentSpanAttributes(span, attributes);
            try {
                return await body(span);
            } catch (error) {
                const isAbort =
                    error !== null &&
                    typeof error === "object" &&
                    (error as { name?: unknown }).name === "AbortError";
                const name = isAbort ? "AbortError" : "ActionError";
                const message = isAbort ? "cancelled" : "action failed";
                span.recordException({ name, message });
                span.setStatus({ code: SpanStatusCode.ERROR, message });
                throw error;
            } finally {
                span.end();
            }
        },
    );
}
