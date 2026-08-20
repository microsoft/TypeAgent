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
    anyCancellationSignalAborted,
    recordSpanFailure,
    type CancellationSignals,
    type SpanFailureNames,
} from "./spanFailure.js";
import {
    logReasoningCompleted,
    logReasoningStarted,
} from "./structuredEvents.js";

const REASONING_FAILURE: SpanFailureNames = {
    errorName: "ReasoningError",
    failureMessage: "reasoning failed",
};

export const REASONING_SPAN_EVENTS = Object.freeze({
    TOOL_CALL: "reasoning.tool_call",
    TOOL_CALL_OVERFLOW: "reasoning.tool_call.overflow",
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
        !Number.isInteger(toolCallNumber) ||
        toolCallNumber < 1
    ) {
        return;
    }
    if (toolCallNumber > REASONING_TOOL_CALL_NUMBER_CAP) {
        if (state.overflowEventEmitted) {
            return;
        }
        state.overflowEventEmitted = true;
        state.span.addEvent(REASONING_SPAN_EVENTS.TOOL_CALL_OVERFLOW);
        return;
    }
    state.span.addEvent(REASONING_SPAN_EVENTS.TOOL_CALL, {
        tool_call_number: toolCallNumber,
    });
}

/**
 * Run a reasoning body inside a `typeagent.reasoning` span.
 *
 * `cancellationSignals` are the signals the caller holds: a cancelled or
 * timed-out run usually throws whatever the provider was in the middle of,
 * which says nothing about having been cancelled.
 */
export async function wrapReasoningSpan<T>(
    attributes: otel.TypeAgentSpanAttributes,
    body: (span: Span) => Promise<T>,
    cancellationSignals?: CancellationSignals,
): Promise<T> {
    const tracer: Tracer = trace.getTracer(
        otel.INSTRUMENTATION_SCOPE_NAME,
        otel.INSTRUMENTATION_SCOPE_VERSION,
    );
    return tracer.startActiveSpan(
        otel.TYPEAGENT_SPAN_NAMES.REASONING,
        async (span) => {
            const effectiveAttributes = {
                ...otel.getActiveTypeAgentSpanAttributes(),
                ...attributes,
            };
            otel.setTypeAgentSpanAttributes(span, effectiveAttributes);
            const state: ReasoningSpanState = {
                span,
                ended: false,
                overflowEventEmitted: false,
            };
            const spanContext: Context = otel.setActiveTypeAgentSpanAttributes(
                context.active().setValue(REASONING_STATE_KEY, state),
                effectiveAttributes,
            );
            try {
                return await context.with(spanContext, () =>
                    withChatModelTelemetryContext(
                        {
                            phase: "reasoning",
                            purpose: "reasoning",
                            scope: "foreground",
                        },
                        () => body(span),
                    ),
                );
            } catch (error) {
                recordSpanFailure(
                    span,
                    error,
                    REASONING_FAILURE,
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

export function runInReasoningSpan<T>(
    context: ActionContext<CommandHandlerContext>,
    body: (span: Span) => Promise<T>,
    modelAttributes?: Pick<
        otel.TypeAgentSpanAttributes,
        "genAiSystem" | "genAiRequestModel"
    >,
    cancellationSignal?: AbortSignal,
): Promise<T> {
    const systemContext = context.sessionContext.agentContext;
    const sessionId = systemContext.session.sessionDirPath
        ? getSessionName(systemContext.session.sessionDirPath)
        : undefined;
    const attributes: {
        -readonly [K in keyof otel.TypeAgentSpanAttributes]: otel.TypeAgentSpanAttributes[K];
    } = { ...modelAttributes };
    if (sessionId !== undefined) {
        attributes.sessionId = sessionId;
    }
    if (systemContext.activationId !== undefined) {
        attributes.activationId = systemContext.activationId;
    }
    if (systemContext.traceId !== undefined) {
        attributes.traceId = systemContext.traceId;
    }

    const requestId = systemContext.currentRequestId?.requestId;
    const eventModel = {
        ...(modelAttributes?.genAiSystem === undefined
            ? {}
            : { provider: modelAttributes.genAiSystem }),
        ...(modelAttributes?.genAiRequestModel === undefined
            ? {}
            : { model: modelAttributes.genAiRequestModel }),
    };
    // Both the span and the `reasoning:completed` event below classify from
    // this one list, so they cannot disagree.
    const cancellationSignals: CancellationSignals = [
        cancellationSignal,
        context.abortSignal,
    ];
    return wrapReasoningSpan(
        attributes,
        async (span) => {
            const startedAt = Date.now();
            if (requestId !== undefined) {
                logReasoningStarted(systemContext.logger, {
                    requestId,
                    ...eventModel,
                });
            }
            try {
                const result = await body(span);
                if (requestId !== undefined) {
                    logReasoningCompleted(systemContext.logger, {
                        requestId,
                        ...eventModel,
                        success: true,
                        cancelled: false,
                        elapsedMs: Date.now() - startedAt,
                    });
                }
                return result;
            } catch (error) {
                const cancelled = otel.isTelemetryCancellation(
                    error,
                    anyCancellationSignalAborted(cancellationSignals),
                );
                if (requestId !== undefined) {
                    logReasoningCompleted(systemContext.logger, {
                        requestId,
                        ...eventModel,
                        success: false,
                        cancelled,
                        elapsedMs: Date.now() - startedAt,
                    });
                }
                throw error;
            }
        },
        cancellationSignals,
    );
}
