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
    /**
     * Explicit parent context. Defaults to ROOT_CONTEXT so unrelated ambient
     * instrumentation cannot adopt the TypeAgent request span accidentally.
     */
    readonly parentContext?: Context | undefined;
    readonly captureSensitiveErrorDetails?: boolean | undefined;
}

/**
 * Wrap the outermost dispatcher request/command handler in the root
 * `typeagent.request` span. Callers use this from `processCommand` (the
 * async boundary that produces a `CommandResult`); nested translation,
 * reasoning, and action spans join this span automatically through
 * `startActiveSpan`'s AsyncHooks-based context propagation.
 *
 * Placement note: `processCommand` is the outermost async handler that
 * *produces* a `CommandResult`. A small amount of per-request IPC
 * (`displayLog.logCommandResult`, `clientIO.notify("commandComplete")`)
 * runs in the RequestQueue drain callback *after* `processCommand`
 * returns. That work is intentionally outside the root span: it emits
 * no LLM/action/translation work of its own, is best-effort (both
 * callers wrap it in `try {} catch {}`), and Steps 3-6 do not add child
 * spans there. Wrapping inside `processCommand` also automatically
 * covers the `Dispatcher.checkCache` entry variant, which calls
 * `processCommand` directly without going through the queue.
 *
 * Contract:
 *
 * - Uses the *global* OTel tracer provider. When no provider has been
 *   registered (unconfigured host) the API returns a noop tracer and
 *   `startActiveSpan` executes the callback with a noop span, so this
 *   wrapper is safe to call unconditionally.
 * - Applies `setTypeAgentSpanAttributes` once at span start. Attribute
 *   updates that only become known later (agent name, action name) are
 *   the caller's responsibility to set on the span the callback receives.
 * - On thrown exception: records a safe exception classification, sets status
 *   ERROR with a stable message, ends the span, and rethrows. Original details
 *   are included only when sensitive error capture is explicitly enabled.
 * - On success where the returned result has `cancelled === true`: sets
 *   status ERROR with message `"cancelled"` and ends the span. This is
 *   how the dispatcher surfaces user-visible cancellation (the design
 *   doc's "failures converted to `ActionResult`" rule).
 * - On success otherwise (including `undefined` result): leaves status
 *   UNSET (per OTel guidance, OK is discouraged) and ends the span.
 * - The span ends *exactly once* on every path, via a `finally` block.
 *
 * The wrapper deliberately does NOT accept or return the span - callers
 * inside the callback that need to add more attributes read the active
 * span via `trace.getActiveSpan()`.
 */
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
                otel.recordTypeAgentSpanException(span, e, {
                    safeName: isAbort ? "AbortError" : "RequestError",
                    safeMessage: isAbort ? "cancelled" : "request failed",
                    captureSensitiveDetails:
                        options?.captureSensitiveErrorDetails,
                });
                throw e;
            } finally {
                span.end();
            }
        },
    );
}
