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
import {
    getChatModelTelemetryContext,
    type ChatModelTelemetryContext,
} from "./chatModelTelemetryContext.js";

const logger = new ChildLogger(
    new MultiSinkLogger([createOtelLoggerSink()]),
    "aiclient",
);

/**
 * How long the foreground-default ratchet stays quiet after reporting. One
 * warning per unattributed call would be as noisy as the calls themselves, so
 * the diagnostic is emitted at most once per window and carries the number of
 * calls the window covered.
 */
const DEFAULT_CLASSIFICATION_WINDOW_MS = 60_000;

let defaultClassificationCount = 0;
let defaultClassificationReportedAt: number | undefined;

/**
 * Reset the foreground-default ratchet's window and counter.
 *
 * @internal Exists so tests can assert the rate-limiting behavior
 * deterministically; production code never calls it.
 */
export function resetLlmClassificationDiagnostics(): void {
    defaultClassificationCount = 0;
    defaultClassificationReportedAt = undefined;
}

/**
 * Count a foreground call that nobody classified and, at most once per
 * window, report the running total.
 *
 * The diagnostic carries no call-site identity, no stack, and no payload: it
 * answers "are unattributed foreground calls still happening, and roughly how
 * many" without adding cardinality or leaking prompts. It cannot recurse
 * (emitting a log event makes no model call) and it never propagates a
 * failure, so a broken logger degrades telemetry rather than the request.
 *
 * The classification rides on storage this package owns rather than on the
 * OTel context, so the count means the same thing in a logs-only process as it
 * does with tracing enabled.
 */
function noteClassificationSource(
    classification: ChatModelTelemetryContext,
    structuredLogger: Logger,
): void {
    if (
        classification.scope !== "foreground" ||
        classification.classificationSource !== "default"
    ) {
        return;
    }
    defaultClassificationCount += 1;
    const now = Date.now();
    if (
        defaultClassificationReportedAt !== undefined &&
        now - defaultClassificationReportedAt < DEFAULT_CLASSIFICATION_WINDOW_MS
    ) {
        return;
    }
    defaultClassificationReportedAt = now;
    const count = defaultClassificationCount;
    defaultClassificationCount = 0;
    structuredLogger.logEvent(
        "llm:classification:default",
        {
            scope: "foreground",
            count,
            windowMs: DEFAULT_CLASSIFICATION_WINDOW_MS,
        },
        "warning",
    );
}

export type ChatModelTelemetryInfo = {
    provider: string;
    model?: string;
};

type LlmCallState = {
    readonly span: Span;
    readonly activeContext: Context;
    readonly attributes: otel.TypeAgentSpanAttributes;
    readonly startedAt: number;
    readonly correlation: LlmCorrelation;
    readonly classification: ChatModelTelemetryContext;
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
            const result = await runInCallContext(state, () =>
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
            const result = await runInCallContext(state, () =>
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

/**
 * Re-enter the scope this call established: the OTel context (so the provider's
 * own spans nest under `typeagent.llm`) and the correlation attributes (so a
 * log record emitted from here is correlated even with tracing disabled).
 */
function runInCallContext<T>(state: LlmCallState, body: () => T): T {
    return otel.runInTypeAgentTelemetryContext(
        state.activeContext,
        state.attributes,
        body,
    );
}

/**
 * Run a telemetry side effect that must never disturb the model call it
 * describes. A broken logger or span implementation degrades telemetry only.
 */
function safely(body: () => void): void {
    try {
        body();
    } catch {
        // Telemetry must not fail the model call it is describing.
    }
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
    const classification = getChatModelTelemetryContext();
    const attributes = {
        ...inherited,
        genAiSystem: info.provider,
        ...(info.model === undefined ? {} : { genAiRequestModel: info.model }),
        llmPhase: classification.phase,
        llmPurpose: classification.purpose,
        llmScope: classification.scope,
        llmClassificationSource: classification.classificationSource,
    };
    safely(() => otel.setTypeAgentSpanAttributes(span, attributes));
    const state = {
        span,
        activeContext: otel.setActiveTypeAgentSpanAttributes(
            trace.setSpan(context.active(), span),
            attributes,
        ),
        attributes,
        startedAt: Date.now(),
        correlation: getLlmCorrelation(inherited),
        classification,
        logger: structuredLogger,
        ended: false,
    };
    if (otel.isStructuredLoggingEnabled()) {
        safely(() =>
            runInCallContext(state, () => {
                structuredLogger.logEvent("llm:started", {
                    provider: info.provider,
                    ...(info.model === undefined ? {} : { model: info.model }),
                    operation: "chat",
                    streaming,
                    ...classification,
                    ...state.correlation,
                });
                noteClassificationSource(classification, structuredLogger);
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
            const next = await runInCallContext(state, () => source.next());
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
            cancelLlmCall(state, info);
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

/**
 * Record a call that returned rather than threw.
 *
 * A failure `Result` carries only typechat's message string, which may quote
 * the provider response and is never parsed here. The transport attaches what
 * it actually knew before flattening (see
 * `attachTelemetryErrorClassification`), so a real 401/429/timeout keeps its
 * category; when it recognized nothing it attaches nothing (see
 * `classifyTelemetryErrorIfRecognized`) rather than an `internal` that would
 * overwrite this fallback. Every path that produces a returned failure still
 * originates in the provider call, so `provider` is the truthful fallback and
 * nothing else about the failure is claimed.
 */
function finishLlmCall(
    state: LlmCallState,
    info: ChatModelTelemetryInfo,
    result: Result<unknown>,
): void {
    if (state.ended) {
        return;
    }
    state.ended = true;
    try {
        const success = result.success;
        const classification = success
            ? undefined
            : (otel.readTelemetryErrorClassification(result) ?? {
                  errorCategory: "provider" as const,
              });
        const cancelled = classification?.errorCategory === "cancelled";
        if (!success) {
            const message = cancelled ? "cancelled" : "model returned failure";
            safely(() =>
                state.span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message,
                }),
            );
        }
        emitCompleted(
            state,
            info,
            success,
            success ? "succeeded" : cancelled ? "cancelled" : "failed",
            classification,
        );
    } finally {
        endSpan(state);
    }
}

/**
 * Record a call that threw. The thrown value is classified once, and the
 * span status, the event status, its severity, and whether classification
 * fields are emitted at all are all derived from that single result - so a
 * cancellation wrapped in another error cannot be reported as a failure on one
 * signal and a cancellation on another.
 */
function failLlmCall(
    state: LlmCallState,
    info: ChatModelTelemetryInfo,
    error: unknown,
): void {
    if (state.ended) {
        return;
    }
    state.ended = true;
    try {
        const classification = otel.classifyTelemetryError(error);
        const cancelled = classification.errorCategory === "cancelled";
        const message = cancelled ? "cancelled" : "model call failed";
        safely(() => {
            state.span.recordException({
                name: cancelled ? "AbortError" : "ModelError",
                message,
            });
            state.span.setStatus({ code: SpanStatusCode.ERROR, message });
        });
        emitCompleted(
            state,
            info,
            false,
            cancelled ? "cancelled" : "failed",
            classification,
        );
    } finally {
        endSpan(state);
    }
}

/**
 * End the span exactly once. `state.ended` already guards re-entry, so this
 * only has to survive a span implementation that throws - the span must be
 * ended even when emitting the completion event failed, or a broken logger
 * would leak an unfinished span per call.
 */
function endSpan(state: LlmCallState): void {
    safely(() => state.span.end());
}

function emitCompleted(
    state: LlmCallState,
    info: ChatModelTelemetryInfo,
    success: boolean,
    status: "succeeded" | "failed" | "cancelled",
    classification: otel.TelemetryErrorClassification | undefined,
): void {
    if (!otel.isStructuredLoggingEnabled()) {
        return;
    }
    safely(() =>
        runInCallContext(state, () =>
            state.logger.logEvent(
                "llm:completed",
                {
                    provider: info.provider,
                    ...(info.model === undefined ? {} : { model: info.model }),
                    operation: "chat",
                    ...state.classification,
                    ...state.correlation,
                    success,
                    status,
                    elapsedMs: Date.now() - state.startedAt,
                    // A cancellation is a disposition, not a failure worth
                    // classifying, so only real failures carry the fields.
                    ...(status === "failed" && classification !== undefined
                        ? classification
                        : {}),
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
