// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    context,
    createContextKey,
    SpanStatusCode,
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

export const TRANSLATION_SPAN_EVENTS = Object.freeze({
    GRAMMAR_MATCHED: "translation.grammar.matched",
    GRAMMAR_NO_MATCH: "translation.grammar.no_match",
    CACHE_HIT: "translation.cache.hit",
    CACHE_MISS: "translation.cache.miss",
    CACHE_BYPASSED: "translation.cache.bypassed",
    FALLBACK: "translation.fallback",
    RETRY: "translation.retry",
} as const);

export type TranslationMatchOutcome = "grammar_hit" | "cache_hit" | "miss";

export type TranslationRetryKind = "selected_actions_full" | "same_schema";

interface TranslationSpanState {
    readonly span: Span;
    readonly parentContext: Context;
    retryNumber: number;
    ended: boolean;
}

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

    switch (outcome) {
        case "grammar_hit":
            state.span.addEvent(TRANSLATION_SPAN_EVENTS.GRAMMAR_MATCHED, {
                result_kind: "grammar",
            });
            break;
        case "cache_hit":
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
    state.span.addEvent(TRANSLATION_SPAN_EVENTS.CACHE_BYPASSED, {
        bypass_reason: reason,
    });
}

export function emitTranslationFallback(): void {
    const state = getTranslationState();
    if (state === undefined || state.ended) {
        return;
    }
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
 * Run a translation operation in one active `typeagent.translation` span.
 * Re-entrant calls reuse the current translation span so the outer
 * interpret-request path can include grammar/cache work while direct
 * `translateRequest` callers still receive translation telemetry.
 */
export async function wrapTranslationSpan<T>(
    attributes: otel.TypeAgentSpanAttributes,
    body: (span: Span) => Promise<T>,
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
                ended: false,
            };
            const spanContext: Context = otel.setActiveTypeAgentSpanAttributes(
                context.active().setValue(TRANSLATION_STATE_KEY, state),
                effectiveAttributes,
            );
            try {
                return await context.with(spanContext, () =>
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
                const isAbort =
                    error !== null &&
                    typeof error === "object" &&
                    (error as { name?: unknown }).name === "AbortError";
                const name = isAbort ? "AbortError" : "TranslationError";
                const message = isAbort ? "cancelled" : "translation failed";
                span.recordException({ name, message });
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message,
                });
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

    return wrapTranslationSpan(attributes, body);
}
