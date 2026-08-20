// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    context,
    createContextKey,
    trace,
    type Context,
    type Span,
    type Tracer,
} from "@opentelemetry/api";
import type { ActionContext } from "@typeagent/agent-sdk";
import { withChatModelTelemetryContext } from "@typeagent/aiclient";
import { otel } from "@typeagent/telemetry";
import type { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { getSessionName } from "../context/session.js";
import {
    recordSpanFailure,
    type CancellationSignals,
    type SpanFailureNames,
} from "./spanFailure.js";

const TRANSLATION_FAILURE: SpanFailureNames = {
    errorName: "TranslationError",
    failureMessage: "translation failed",
};

export const TRANSLATION_SPAN_EVENTS = Object.freeze({
    GRAMMAR_MATCHED: "translation.grammar.matched",
    GRAMMAR_NO_MATCH: "translation.grammar.no_match",
    CACHE_HIT: "translation.cache.hit",
    CACHE_MISS: "translation.cache.miss",
    CACHE_BYPASSED: "translation.cache.bypassed",
    LLM_INVOKED: "translation.llm.invoked",
    FALLBACK: "translation.fallback",
    RETRY: "translation.retry",
} as const);

export type TranslationMatchOutcome = "grammar_hit" | "cache_hit" | "miss";

export type TranslationRetryKind = "selected_actions_full" | "same_schema";

/**
 * A single routing mechanism actually exercised during one translation. Unlike
 * the terminal `strategy`/`matchOutcome` (which a later lookup can overwrite),
 * routes accumulate additively so a mixed activity-context translation that
 * hits the cache and then calls the LLM for an unknown action records both.
 * The vocabulary is closed (three values), so the derived set stays
 * low-cardinality.
 */
export type TranslationRoute = "grammar" | "cache" | "llm";

interface TranslationSpanState {
    readonly span: Span;
    readonly parentContext: Context;
    retryNumber: number;
    // Routing decisions accumulated from the emit* helpers below. This is the
    // single source of truth for the routing summary surfaced on the
    // `translation:completed` structured event - it is not a parallel copy.
    matchOutcome?: TranslationMatchOutcome;
    cacheBypassReason?: TranslationCacheBypassReason;
    // Additive set of routing mechanisms observed during this translation. A
    // later lookup overwrites `matchOutcome`, but routes are only ever added,
    // so mixed cache-then-LLM paths keep both facts. Source of truth for the
    // completion event's `routes`.
    readonly routes: Set<TranslationRoute>;
    fallback: boolean;
    ended: boolean;
}

/**
 * Bounded, low-cardinality snapshot of the routing decisions taken during one
 * translation. Every field is either an enumerated value from the span-event
 * vocabulary above or a small integer count, so it is safe to attach to a
 * structured lifecycle event without leaking user input or high-cardinality
 * text.
 */
export type TranslationRoutingSummary = {
    // Terminal cache/grammar lookup outcome, when a lookup was performed.
    matchOutcome?: TranslationMatchOutcome;
    // Why the cache lookup was skipped, when it was bypassed.
    cacheBypassReason?: TranslationCacheBypassReason;
    // Every routing mechanism actually exercised (cache/grammar hit and/or LLM
    // call). Present only when at least one was observed; sorted for stability.
    // Represents mixed routing additively rather than collapsing to a single
    // terminal value.
    routes?: readonly TranslationRoute[];
    // Whether an assistant-switch fallback occurred during translation.
    fallback: boolean;
    // Number of translation retries (any tier) that occurred.
    retryCount: number;
};

const TRANSLATION_STATE_KEY = createContextKey(
    "typeagent.dispatcher.translationSpanState",
);

function getTranslationState(): TranslationSpanState | undefined {
    return context.active().getValue(TRANSLATION_STATE_KEY) as
        | TranslationSpanState
        | undefined;
}

export function emitTranslationMatchResult(
    outcome: TranslationMatchOutcome,
): void {
    const state = getTranslationState();
    if (state === undefined || state.ended) {
        return;
    }

    state.matchOutcome = outcome;
    switch (outcome) {
        case "grammar_hit":
            state.routes.add("grammar");
            state.span.addEvent(TRANSLATION_SPAN_EVENTS.GRAMMAR_MATCHED, {
                result_kind: "grammar",
            });
            break;
        case "cache_hit":
            state.routes.add("cache");
            state.span.addEvent(TRANSLATION_SPAN_EVENTS.CACHE_HIT, {
                result_kind: "construction",
            });
            break;
        case "miss":
            state.span.addEvent(TRANSLATION_SPAN_EVENTS.GRAMMAR_NO_MATCH);
            state.span.addEvent(TRANSLATION_SPAN_EVENTS.CACHE_MISS);
            break;
    }
}

export type TranslationCacheBypassReason =
    | "request_constraints"
    | "reasoning_request"
    | "cache_disabled";

export function emitTranslationCacheBypass(
    reason: TranslationCacheBypassReason,
): void {
    const state = getTranslationState();
    if (state === undefined || state.ended) {
        return;
    }
    state.cacheBypassReason = reason;
    state.span.addEvent(TRANSLATION_SPAN_EVENTS.CACHE_BYPASSED, {
        bypass_reason: reason,
    });
}

/**
 * Record that this translation actually invoked the LLM. Additive: it never
 * clears an earlier cache/grammar route, so a mixed activity-context path that
 * hit the cache and then called the model for an unknown action reports both.
 */
export function emitTranslationLlmInvoked(): void {
    const state = getTranslationState();
    if (state === undefined || state.ended) {
        return;
    }
    state.routes.add("llm");
    state.span.addEvent(TRANSLATION_SPAN_EVENTS.LLM_INVOKED);
}

export function emitTranslationFallback(): void {
    const state = getTranslationState();
    if (state === undefined || state.ended) {
        return;
    }
    state.fallback = true;
    state.span.addEvent(TRANSLATION_SPAN_EVENTS.FALLBACK, {
        fallback_tier: "assistant_switch",
    });
}

export function emitTranslationRetry(kind: TranslationRetryKind): void {
    const state = getTranslationState();
    if (state === undefined || state.ended) {
        return;
    }
    state.retryNumber += 1;
    state.span.addEvent(TRANSLATION_SPAN_EVENTS.RETRY, {
        retry_number: state.retryNumber,
        retry_kind: kind,
    });
}

/**
 * Snapshot the routing decisions recorded on the active translation span.
 * Returns `undefined` when no translation span is active (for example, a
 * cache/user path that never entered `runInTranslationSpan`). Must be called
 * from within the translation span's async context.
 */
export function readTranslationRoutingSummary():
    | TranslationRoutingSummary
    | undefined {
    const state = getTranslationState();
    if (state === undefined) {
        return undefined;
    }
    const routes =
        state.routes.size === 0 ? undefined : [...state.routes].sort();
    return {
        ...(state.matchOutcome === undefined
            ? {}
            : { matchOutcome: state.matchOutcome }),
        ...(state.cacheBypassReason === undefined
            ? {}
            : { cacheBypassReason: state.cacheBypassReason }),
        ...(routes === undefined ? {} : { routes }),
        fallback: state.fallback,
        retryCount: state.retryNumber,
    };
}

// Non-enumerable carrier for surfacing the routing summary from a failed
// translation to the completion-event boundary, which runs after the span's
// async context has been torn down. Non-enumerable so it never serializes into
// logs or crosses a redaction boundary.
const TRANSLATION_ROUTING_ERROR_KEY = "__typeagentTranslationRouting";

export function attachTranslationRoutingToError(
    error: unknown,
    summary: TranslationRoutingSummary | undefined,
): void {
    if (summary === undefined || error === null || typeof error !== "object") {
        return;
    }
    try {
        Object.defineProperty(error, TRANSLATION_ROUTING_ERROR_KEY, {
            value: summary,
            enumerable: false,
            configurable: true,
            writable: true,
        });
    } catch {
        // Best-effort diagnostics: ignore frozen/sealed error objects.
    }
}

export function readTranslationRoutingFromError(
    error: unknown,
): TranslationRoutingSummary | undefined {
    if (error === null || typeof error !== "object") {
        return undefined;
    }
    const value = (error as Record<string, unknown>)[
        TRANSLATION_ROUTING_ERROR_KEY
    ];
    if (
        value !== null &&
        typeof value === "object" &&
        typeof (value as TranslationRoutingSummary).fallback === "boolean" &&
        typeof (value as TranslationRoutingSummary).retryCount === "number"
    ) {
        return value as TranslationRoutingSummary;
    }
    return undefined;
}

/**
 * Run a translation operation in one active `typeagent.translation` span.
 * Re-entrant calls reuse the current translation span so the outer
 * interpret-request path can include grammar/cache work while direct
 * `translateRequest` callers still receive translation telemetry.
 *
 * `cancellationSignals` are the signals the caller holds, so a cancellation
 * that surfaces as an unrelated-looking failure is recorded as a cancellation
 * on the span and on the `translation:completed` event alike.
 */
export async function wrapTranslationSpan<T>(
    attributes: otel.TypeAgentSpanAttributes,
    body: (span: Span) => Promise<T>,
    cancellationSignals?: CancellationSignals,
): Promise<T> {
    const activeState = getTranslationState();
    if (activeState !== undefined && !activeState.ended) {
        return body(activeState.span);
    }

    let parentContext = context.active();
    if (
        activeState?.ended === true &&
        trace.getSpan(parentContext)?.spanContext().spanId ===
            activeState.span.spanContext().spanId
    ) {
        parentContext = activeState.parentContext;
    }

    const tracer: Tracer = trace.getTracer(
        otel.INSTRUMENTATION_SCOPE_NAME,
        otel.INSTRUMENTATION_SCOPE_VERSION,
    );
    return tracer.startActiveSpan(
        otel.TYPEAGENT_SPAN_NAMES.TRANSLATION,
        {},
        parentContext,
        async (span) => {
            const effectiveAttributes = {
                ...otel.getActiveTypeAgentSpanAttributes(parentContext),
                ...attributes,
            };
            otel.setTypeAgentSpanAttributes(span, effectiveAttributes);
            const state: TranslationSpanState = {
                span,
                parentContext,
                retryNumber: 0,
                routes: new Set<TranslationRoute>(),
                fallback: false,
                ended: false,
            };
            const spanContext: Context = otel.setActiveTypeAgentSpanAttributes(
                context.active().setValue(TRANSLATION_STATE_KEY, state),
                effectiveAttributes,
            );
            try {
                return await otel.runInTypeAgentTelemetryContext(
                    spanContext,
                    effectiveAttributes,
                    () =>
                        withChatModelTelemetryContext(
                            {
                                phase: "translation",
                                purpose: "action-generation",
                                scope: "foreground",
                            },
                            () => body(span),
                        ),
                );
            } catch (error) {
                recordSpanFailure(
                    span,
                    error,
                    TRANSLATION_FAILURE,
                    cancellationSignals,
                );
                throw error;
            } finally {
                state.ended = true;
                span.end();
            }
        },
    );
}

export function runInTranslationSpan<T>(
    context: ActionContext<CommandHandlerContext>,
    body: (span: Span) => Promise<T>,
): Promise<T> {
    const systemContext = context.sessionContext.agentContext;
    const sessionId = systemContext.session.sessionDirPath
        ? getSessionName(systemContext.session.sessionDirPath)
        : undefined;
    const attributes: {
        -readonly [K in keyof otel.TypeAgentSpanAttributes]: otel.TypeAgentSpanAttributes[K];
    } = {};
    if (sessionId !== undefined) {
        attributes.sessionId = sessionId;
    }
    if (systemContext.activationId !== undefined) {
        attributes.activationId = systemContext.activationId;
    }
    if (systemContext.traceId !== undefined) {
        attributes.traceId = systemContext.traceId;
    }

    // The same signal `requestCommandHandler` reads when it emits
    // `translation:completed`, so the span and that event agree about a
    // cancellation that surfaced as an ordinary translation failure.
    return wrapTranslationSpan(attributes, body, [
        systemContext.currentAbortSignal,
    ]);
}
