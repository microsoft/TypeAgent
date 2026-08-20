// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    context,
    SpanStatusCode,
    ROOT_CONTEXT,
    trace,
    type Context,
    type Span,
    type Tracer,
} from "@opentelemetry/api";
import { otel } from "@typeagent/telemetry";
import { recordSpanFailure, type SpanFailureNames } from "./spanFailure.js";

const REQUEST_FAILURE: SpanFailureNames = {
    errorName: "RequestError",
    failureMessage: "request failed",
};

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
            return context.with(
                otel.setActiveTypeAgentSpanAttributes(
                    context.active(),
                    attributes,
                ),
                async () => {
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
                        // The thrown value is classified rather than
                        // name-checked: a cancellation is frequently wrapped,
                        // and `DOMException` is not always `instanceof Error`
                        // in Node, so nothing here may assume an `Error`. A
                        // cancellation the request itself observed arrives as
                        // `result.cancelled` above, not as a throw, so no
                        // signal is threaded in here.
                        recordSpanFailure(span, e, REQUEST_FAILURE);
                        throw e;
                    } finally {
                        span.end();
                    }
                },
            );
        },
    );
}
