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
    span.addEvent(ACTION_SPAN_EVENTS.SETUP_FAILED, {
        failure_kind: kind,
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: kind });
}

export function recordActionResultError(span: Span): void {
    span.addEvent(ACTION_SPAN_EVENTS.RESULT_ERROR, {
        failure_kind: "result_error",
    });
    span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "result_error",
    });
}

export function recordActionHandlerException(
    span: Span,
    error: unknown,
    captureSensitiveErrorDetails = false,
): void {
    otel.recordTypeAgentSpanException(span, error, {
        safeName: "ActionHandlerError",
        safeMessage: "action handler failed",
        captureSensitiveDetails: captureSensitiveErrorDetails,
    });
}

export interface ActionSpanOptions {
    readonly captureSensitiveErrorDetails?: boolean | undefined;
}

export async function wrapActionSpan<T>(
    attributes: otel.TypeAgentSpanAttributes,
    body: (span: Span) => Promise<T>,
    options: ActionSpanOptions = {},
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
                otel.recordTypeAgentSpanException(span, error, {
                    safeName: isAbort ? "AbortError" : "ActionError",
                    safeMessage: isAbort ? "cancelled" : "action failed",
                    captureSensitiveDetails:
                        options.captureSensitiveErrorDetails,
                });
                throw error;
            } finally {
                span.end();
            }
        },
    );
}
