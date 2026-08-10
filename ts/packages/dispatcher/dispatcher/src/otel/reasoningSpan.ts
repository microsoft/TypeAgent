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
import { otel } from "@typeagent/telemetry";
import type { CommandHandlerContext } from "../context/commandHandlerContext.js";
import { getSessionName } from "../context/session.js";

export const REASONING_SPAN_EVENTS = Object.freeze({
    TOOL_CALL: "reasoning.tool_call",
    CANCEL: "reasoning.cancel",
} as const);

export const REASONING_TOOL_CALL_NUMBER_CAP = 100;

interface ReasoningSpanState {
    readonly span: Span;
    ended: boolean;
    overflowEventEmitted: boolean;
}

const REASONING_STATE_KEY = createContextKey(
    "typeagent.dispatcher.reasoningSpanState",
);

function getReasoningState(): ReasoningSpanState | undefined {
    return context.active().getValue(REASONING_STATE_KEY) as
        | ReasoningSpanState
        | undefined;
}

export function emitReasoningToolCall(toolCallNumber: number): void {
    const state = getReasoningState();
    if (
        state === undefined ||
        state.ended ||
        !Number.isFinite(toolCallNumber) ||
        toolCallNumber < 1
    ) {
        return;
    }
    if (toolCallNumber > REASONING_TOOL_CALL_NUMBER_CAP) {
        if (state.overflowEventEmitted) {
            return;
        }
        state.overflowEventEmitted = true;
    }
    state.span.addEvent(REASONING_SPAN_EVENTS.TOOL_CALL, {
        tool_call_number:
            toolCallNumber > REASONING_TOOL_CALL_NUMBER_CAP
                ? "overflow"
                : toolCallNumber,
    });
}

export interface ReasoningSpanOptions {
    readonly captureSensitiveErrorDetails?: boolean | undefined;
}

export async function wrapReasoningSpan<T>(
    attributes: otel.TypeAgentSpanAttributes,
    body: (span: Span) => Promise<T>,
    options: ReasoningSpanOptions = {},
): Promise<T> {
    const tracer: Tracer = trace.getTracer(
        otel.INSTRUMENTATION_SCOPE_NAME,
        otel.INSTRUMENTATION_SCOPE_VERSION,
    );
    return tracer.startActiveSpan(
        otel.TYPEAGENT_SPAN_NAMES.REASONING,
        async (span) => {
            otel.setTypeAgentSpanAttributes(span, attributes);
            const state: ReasoningSpanState = {
                span,
                ended: false,
                overflowEventEmitted: false,
            };
            const spanContext: Context = context
                .active()
                .setValue(REASONING_STATE_KEY, state);
            try {
                return await context.with(spanContext, () => body(span));
            } catch (error) {
                const isAbort =
                    error !== null &&
                    typeof error === "object" &&
                    (error as { name?: unknown }).name === "AbortError";
                if (isAbort) {
                    span.addEvent(REASONING_SPAN_EVENTS.CANCEL);
                }
                otel.recordTypeAgentSpanException(span, error, {
                    safeName: isAbort ? "AbortError" : "ReasoningError",
                    safeMessage: isAbort ? "cancelled" : "reasoning failed",
                    captureSensitiveDetails:
                        options.captureSensitiveErrorDetails,
                });
                throw error;
            } finally {
                state.ended = true;
                span.end();
            }
        },
    );
}

export function runInReasoningSpan<T>(
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

    return wrapReasoningSpan(attributes, body, {
        captureSensitiveErrorDetails:
            systemContext.telemetryOptions.captureSensitiveErrorDetails,
    });
}
