// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    context,
    SpanStatusCode,
    trace,
    type Context,
    type Span,
} from "@opentelemetry/api";
import {
    ChildLogger,
    MultiSinkLogger,
    createOtelLoggerSink,
    otel,
    type Logger,
} from "@typeagent/telemetry";
import type { Result } from "typechat";
import type { CompletionUsageStats } from "./apiTypes.js";
import type {
    ChatModelWithStreaming,
    CompleteUsageStatsCallback,
} from "./models.js";

const logger = new ChildLogger(
    new MultiSinkLogger([createOtelLoggerSink()]),
    "aiclient",
);

export type ChatModelTelemetryInfo = {
    provider: string;
    model?: string;
};

type LlmCallState = {
    readonly span: Span;
    readonly activeContext: Context;
    readonly startedAt: number;
    readonly correlation: LlmCorrelation;
    readonly logger: Logger;
    usage?: CompletionUsageStats;
    ended: boolean;
};

type LlmCorrelation = {
    -readonly [Key in
        | "sessionId"
        | "activationId"
        | "requestId"
        | "traceId"]?: otel.TypeAgentSpanAttributes[Key];
};

const INSTRUMENTED_CHAT_MODEL = Symbol("typeagent.instrumentedChatModel");

export function instrumentChatModel(
    model: ChatModelWithStreaming,
    info: ChatModelTelemetryInfo,
    structuredLogger: Logger = logger,
): ChatModelWithStreaming {
    const instrumented = model as ChatModelWithStreaming & {
        [INSTRUMENTED_CHAT_MODEL]?: true;
    };
    if (instrumented[INSTRUMENTED_CHAT_MODEL] === true) {
        return model;
    }

    const complete = model.complete.bind(model);
    model.complete = async (...args) => {
        const state = startLlmCall(info, false, structuredLogger);
        const signal = args[4];
        args[1] = captureUsage(args[1], state);
        try {
            const result = await context.with(state.activeContext, () =>
                complete(...args),
            );
            if (signal?.aborted === true) {
                cancelLlmCall(state, info);
            } else {
                finishLlmCall(state, info, result);
            }
            return result;
        } catch (error) {
            failLlmCall(state, info, error);
            throw error;
        }
    };

    const completeStream = model.completeStream.bind(model);
    model.completeStream = async (...args) => {
        const state = startLlmCall(info, true, structuredLogger);
        const signal = args[4];
        args[1] = captureUsage(args[1], state);
        try {
            const result = await context.with(state.activeContext, () =>
                completeStream(...args),
            );
            if (signal?.aborted === true) {
                cancelLlmCall(state, info);
                return result;
            }
            if (!result.success) {
                finishLlmCall(state, info, result);
                return result;
            }
            return {
                success: true,
                data: instrumentStream(result.data, state, info, signal),
            };
        } catch (error) {
            failLlmCall(state, info, error);
            throw error;
        }
    };

    instrumented[INSTRUMENTED_CHAT_MODEL] = true;
    return model;
}

function startLlmCall(
    info: ChatModelTelemetryInfo,
    streaming: boolean,
    structuredLogger: Logger,
): LlmCallState {
    const tracer = trace.getTracer(
        otel.INSTRUMENTATION_SCOPE_NAME,
        otel.INSTRUMENTATION_SCOPE_VERSION,
    );
    const span = tracer.startSpan(otel.TYPEAGENT_SPAN_NAMES.LLM);
    const inherited = otel.getActiveTypeAgentSpanAttributes();
    const attributes = {
        ...inherited,
        genAiSystem: info.provider,
        ...(info.model === undefined ? {} : { genAiRequestModel: info.model }),
    };
    otel.setTypeAgentSpanAttributes(span, attributes);
    const activeContext = otel.setActiveTypeAgentSpanAttributes(
        trace.setSpan(context.active(), span),
        attributes,
    );
    const state = {
        span,
        activeContext,
        startedAt: Date.now(),
        correlation: getLlmCorrelation(inherited),
        logger: structuredLogger,
        ended: false,
    };
    if (otel.isStructuredLoggingEnabled()) {
        context.with(activeContext, () =>
            structuredLogger.logEvent("llm:started", {
                provider: info.provider,
                ...(info.model === undefined ? {} : { model: info.model }),
                operation: "chat",
                streaming,
                ...state.correlation,
            }),
        );
    }
    return state;
}

function captureUsage(
    callback: CompleteUsageStatsCallback | undefined,
    state: LlmCallState,
): CompleteUsageStatsCallback {
    return (usage) => {
        state.usage = usage;
        callback?.(usage);
    };
}

async function* instrumentStream(
    source: AsyncIterableIterator<string>,
    state: LlmCallState,
    info: ChatModelTelemetryInfo,
    signal: AbortSignal | undefined,
): AsyncIterableIterator<string> {
    try {
        while (true) {
            const next = await context.with(state.activeContext, () =>
                source.next(),
            );
            if (next.done) {
                if (signal?.aborted === true) {
                    cancelLlmCall(state, info);
                } else {
                    finishLlmCall(state, info, {
                        success: true,
                        data: "",
                    });
                }
                return;
            }

            yield next.value;
        }
    } catch (error) {
        failLlmCall(state, info, error);
        throw error;
    } finally {
        if (!state.ended) {
            failLlmCall(state, info, { name: "AbortError" });
            await source.return?.();
        }
    }
}

function cancelLlmCall(
    state: LlmCallState,
    info: ChatModelTelemetryInfo,
): void {
    failLlmCall(state, info, { name: "AbortError" });
}

function finishLlmCall(
    state: LlmCallState,
    info: ChatModelTelemetryInfo,
    result: Result<unknown>,
): void {
    if (state.ended) {
        return;
    }
    state.ended = true;
    const success = result.success;
    if (!success) {
        state.span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "model returned failure",
        });
    }
    emitCompleted(state, info, success, success ? "succeeded" : "failed");
    state.span.end();
}

function failLlmCall(
    state: LlmCallState,
    info: ChatModelTelemetryInfo,
    error: unknown,
): void {
    if (state.ended) {
        return;
    }
    state.ended = true;
    const cancelled =
        error !== null &&
        typeof error === "object" &&
        (error as { name?: unknown }).name === "AbortError";
    state.span.recordException({
        name: cancelled ? "AbortError" : "ModelError",
        message: cancelled ? "cancelled" : "model call failed",
    });
    state.span.setStatus({
        code: SpanStatusCode.ERROR,
        message: cancelled ? "cancelled" : "model call failed",
    });
    emitCompleted(state, info, false, cancelled ? "cancelled" : "failed");
    state.span.end();
}

function emitCompleted(
    state: LlmCallState,
    info: ChatModelTelemetryInfo,
    success: boolean,
    status: "succeeded" | "failed" | "cancelled",
): void {
    if (!otel.isStructuredLoggingEnabled()) {
        return;
    }
    context.with(state.activeContext, () =>
        state.logger.logEvent(
            "llm:completed",
            {
                provider: info.provider,
                ...(info.model === undefined ? {} : { model: info.model }),
                operation: "chat",
                ...state.correlation,
                success,
                status,
                elapsedMs: Date.now() - state.startedAt,
                ...(state.usage === undefined
                    ? {}
                    : {
                          inputTokens: state.usage.prompt_tokens,
                          outputTokens: state.usage.completion_tokens,
                          totalTokens: state.usage.total_tokens,
                          ...(state.usage.cached_tokens === undefined
                              ? {}
                              : {
                                    cachedTokens: state.usage.cached_tokens,
                                }),
                      }),
            },
            success ? "info" : status === "cancelled" ? "warning" : "error",
        ),
    );
}

function getLlmCorrelation(
    attributes: otel.TypeAgentSpanAttributes | undefined,
): LlmCorrelation {
    if (attributes === undefined) {
        return {};
    }
    const correlation: LlmCorrelation = {};
    if (attributes.sessionId !== undefined) {
        correlation.sessionId = attributes.sessionId;
    }
    if (attributes.activationId !== undefined) {
        correlation.activationId = attributes.activationId;
    }
    if (attributes.requestId !== undefined) {
        correlation.requestId = attributes.requestId;
    }
    if (attributes.traceId !== undefined) {
        correlation.traceId = attributes.traceId;
    }
    return correlation;
}
