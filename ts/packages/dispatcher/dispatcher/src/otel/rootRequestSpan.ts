// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SpanStatusCode,
    ROOT_CONTEXT,
    trace,
    type Context,
    type Span,
    type Tracer,
} from "@opentelemetry/api";
import { otel } from "@typeagent/telemetry";

/**
 * Result-shaped signal the wrapper uses to detect the caller-visible failure
 * cases the design doc names ("failures converted to `ActionResult`"). The
 * wrapper never inspects any other field of the caller's result, and never
 * touches the caller's result value; the only decision it makes is whether
 * to mark the span status ERROR.
 */
export interface RootRequestSpanResultProbe {
    readonly cancelled?: boolean;
}

export interface RootRequestSpanOptions {
    readonly parentContext?: Context | undefined;
}

export async function wrapRootRequestSpan<
    T extends RootRequestSpanResultProbe | undefined,
>(
    attributes: otel.TypeAgentSpanAttributes,
    body: (span: Span) => Promise<T>,
    options?: RootRequestSpanOptions,
): Promise<T> {
    const tracer: Tracer = trace.getTracer(
        otel.INSTRUMENTATION_SCOPE_NAME,
        otel.INSTRUMENTATION_SCOPE_VERSION,
    );
    return tracer.startActiveSpan(
        otel.TYPEAGENT_SPAN_NAMES.REQUEST,
        {},
        options?.parentContext ?? ROOT_CONTEXT,
        async (span) => {
            otel.setTypeAgentSpanAttributes(span, attributes);
            try {
                const result = await body(span);
                if (result?.cancelled === true) {
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: "cancelled",
                    });
                }
                return result;
            } catch (e) {
                // Detect AbortError before wrapping: DOMException is not
                // always `instanceof Error` in Node, so we can't rely on
                // err.name after the wrapping fallback below.
                const isAbort =
                    e !== null &&
                    typeof e === "object" &&
                    (e as { name?: unknown }).name === "AbortError";
                const name = isAbort ? "AbortError" : "RequestError";
                const message = isAbort ? "cancelled" : "request failed";
                span.recordException({ name, message });
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message,
                });
                throw e;
            } finally {
                span.end();
            }
        },
    );
}
