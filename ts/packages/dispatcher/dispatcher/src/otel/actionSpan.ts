// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    context,
    SpanStatusCode,
    trace,
    type Span,
    type Tracer,
} from "@opentelemetry/api";
import { withChatModelTelemetryContext } from "@typeagent/aiclient";
import { otel } from "@typeagent/telemetry";
import {
    recordSpanFailure,
    type CancellationSignals,
    type SpanFailureNames,
} from "./spanFailure.js";

const ACTION_FAILURE: SpanFailureNames = {
    errorName: "ActionError",
    failureMessage: "action failed",
};

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
 * `cancellationSignals` are the signals the caller holds, passed so a
 * cancellation that surfaces as an unrelated-looking failure is recorded as a
 * cancellation on the span and on the `action:completed` event alike.
 */
export async function wrapActionSpan<T>(
    attributes: otel.TypeAgentSpanAttributes,
    body: (span: Span) => Promise<T>,
    cancellationSignals?: CancellationSignals,
): Promise<T> {
    const tracer: Tracer = trace.getTracer(
        otel.INSTRUMENTATION_SCOPE_NAME,
        otel.INSTRUMENTATION_SCOPE_VERSION,
    );
    return tracer.startActiveSpan(
        otel.TYPEAGENT_SPAN_NAMES.ACTION,
        async (span) => {
            const effectiveAttributes = {
                ...otel.getActiveTypeAgentSpanAttributes(),
                ...attributes,
            };
            otel.setTypeAgentSpanAttributes(span, effectiveAttributes);
            return context.with(
                otel.setActiveTypeAgentSpanAttributes(
                    context.active(),
                    effectiveAttributes,
                ),
                async () => {
                    return withChatModelTelemetryContext(
                        {
                            phase: "action",
                            purpose: "action",
                            scope: "foreground",
                        },
                        async () => {
                            try {
                                return await body(span);
                            } catch (error) {
                                recordSpanFailure(
                                    span,
                                    error,
                                    ACTION_FAILURE,
                                    cancellationSignals,
                                );
                                throw error;
                            } finally {
                                span.end();
                            }
                        },
                    );
                },
            );
        },
    );
}
