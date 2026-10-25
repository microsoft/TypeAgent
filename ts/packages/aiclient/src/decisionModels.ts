// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { type Config } from "@typeagent/config";
import { otel } from "@typeagent/telemetry";
import { type Result, success } from "typechat";
import { ModelType, type CompletionUsageStats } from "./apiTypes.js";
import { discoverEndpointPoolFromConfig } from "./endpointPoolFromConfig.js";
import { makeSingleMemberPool, type EndpointPool } from "./endpointPool.js";
import { callApiWithPool } from "./restClient.js";
import {
    getRuntimeConfig,
    getRuntimeConfigGeneration,
} from "./runtimeConfig.js";
import { getModelProviderOverride } from "./providerMode.js";
import { copilotApiSettingsFromConfig } from "./copilotSettings.js";
import {
    createCopilotModelEndpointProvider,
    CopilotEndpointUnavailableError,
    type CopilotModelEndpointProvider,
} from "./copilotModels.js";
import { RequestAdmissionError } from "./requestBudget.js";
import { context, trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { TokenCounter } from "./tokenCounter.js";

export type DecisionProvider = "azure" | "copilot";
export type DecisionJson =
    | null
    | boolean
    | number
    | string
    | DecisionJson[]
    | { [key: string]: DecisionJson };
export type DecisionQuestion =
    | {
          type: "noul";
          instructions: string;
          criteria?: { true?: string; false?: string };
      }
    | { type: "choice"; instructions: string; criteria: Record<string, string> }
    | { type: "score"; instructions: string; criteria: string[] };
export type DecisionRequest = {
    state: string | { [key: string]: DecisionJson };
    questions: Record<string, DecisionQuestion>;
};
export type DecisionAnswer = (
    | { type: "noul"; noul: number }
    | { type: "choice"; choice: string; probabilities: Record<string, number> }
    | { type: "score"; score: number; probabilities: Record<string, number> }
) & { confidence?: number };
/** Provider-reported counts only; missing fields are never filled with zero. */
export type DecisionUsage = Partial<CompletionUsageStats>;
export type DecisionResponse = {
    answers: Record<string, DecisionAnswer>;
    requestedModel: string;
    reportedModel?: string;
    provider: DecisionProvider;
    usage?: CompletionUsageStats;
    decisionUsage?: DecisionUsage;
    timing?: { durationMs: number };
};
export type DecisionFailureCode =
    | "unavailable"
    | "configuration"
    | "invalid_request"
    | "invalid_response"
    | "refused"
    | "authentication"
    | "authorization"
    | "rate_limit"
    | "network"
    | "timeout"
    | "cancelled"
    | "budget"
    | "provider";
export type DecisionFailure = {
    success: false;
    message: string;
    code: DecisionFailureCode;
    errorCategory: otel.TelemetryErrorCategory;
    retryable: boolean;
    httpStatus?: number;
};
export type DecisionResult<T> = { success: true; data: T } | DecisionFailure;
export interface DecisionModel {
    readonly provider: DecisionProvider;
    readonly model: string;
    readonly configGeneration: number;
    readonly providerSource:
        | "factory"
        | "decision"
        | "override"
        | "config"
        | "default";
    decide(
        request: DecisionRequest,
        options?: { signal?: AbortSignal; timeoutMs?: number },
    ): Promise<DecisionResult<DecisionResponse>>;
}

function failure(
    code: DecisionFailureCode,
    classification?: otel.TelemetryErrorClassification,
): DecisionFailure {
    const category =
        classification?.errorCategory ??
        (code === "invalid_request" ||
        code === "invalid_response" ||
        code === "budget"
            ? "validation"
            : code === "configuration" ||
                code === "unavailable" ||
                code === "refused"
              ? "provider"
              : code);
    return {
        success: false,
        message: `Decision request failed (${code}).`,
        code,
        errorCategory: category,
        retryable:
            classification?.retryable ??
            ["network", "timeout", "rate_limit"].includes(code),
        ...(classification?.httpStatus !== undefined
            ? { httpStatus: classification.httpStatus }
            : {}),
    };
}

/** Construction checks configuration only; credentials are acquired on decide. */
export function createDecisionModel(options?: {
    config?: Config;
    provider?: DecisionProvider;
    endpointProvider?: CopilotModelEndpointProvider;
}): DecisionResult<DecisionModel> {
    try {
        const config = options?.config ?? getRuntimeConfig();
        const { provider, providerSource } = resolveDecisionProvider(
            config,
            options?.provider,
        );
        const model = resolveDecisionModelName(config, provider);
        const pool =
            provider === "azure" ? createAzureDecisionPool(config) : undefined;
        const configGeneration = getRuntimeConfigGeneration();
        let endpointProvider = options?.endpointProvider;
        return success({
            provider,
            model,
            configGeneration,
            providerSource,
            async decide(request, options) {
                if (options?.signal?.aborted) return failure("cancelled");
                const timeoutMs =
                    options?.timeoutMs ??
                    (provider === "azure"
                        ? config.azureOpenAI.maxTimeoutMs
                        : config.copilot?.maxTimeoutMs) ??
                    60_000;
                if (
                    !Number.isSafeInteger(timeoutMs) ||
                    timeoutMs < 1 ||
                    timeoutMs > 2_147_483_647
                )
                    return failure("invalid_request");
                try {
                    validateDecisionRequest(request);
                    request = JSON.parse(JSON.stringify(request));
                } catch {
                    return failure("invalid_request");
                }
                const maxChars =
                    provider === "azure"
                        ? config.azureOpenAI.maxPromptChars
                        : undefined;
                if (
                    maxChars !== undefined &&
                    JSON.stringify({ model, ...request }).length > maxChars
                )
                    return failure("budget");
                const started = performance.now();
                const span = startDecisionSpan(
                    provider,
                    model,
                    providerSource,
                    Object.keys(request.questions).length,
                );
                let attempts = 0;
                const regions = new Set<string>();
                const onAttempt = (member: EndpointPool["members"][number]) => {
                    attempts++;
                    if (member.region) regions.add(member.region);
                };
                const controller = new AbortController();
                const onAbort = () => controller.abort();
                options?.signal?.addEventListener("abort", onAbort, {
                    once: true,
                });
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                let abortListener: (() => void) | undefined;
                const aborted = new Promise<DecisionResult<DecisionResponse>>(
                    (resolve) => {
                        abortListener = () =>
                            resolve(
                                failure(
                                    options?.signal?.aborted
                                        ? "cancelled"
                                        : "timeout",
                                ),
                            );
                        controller.signal.addEventListener(
                            "abort",
                            abortListener,
                            { once: true },
                        );
                    },
                );
                try {
                    const run = () => Promise.race([execute(), aborted]);
                    const result = await (span
                        ? context.with(
                              trace.setSpan(context.active(), span),
                              run,
                          )
                        : run());
                    finishDecisionSpan(
                        span,
                        result,
                        performance.now() - started,
                        attempts,
                        [...regions],
                    );
                    return result;
                } finally {
                    clearTimeout(timer);
                    options?.signal?.removeEventListener("abort", onAbort);
                    if (abortListener)
                        controller.signal.removeEventListener(
                            "abort",
                            abortListener,
                        );
                }

                async function execute(): Promise<
                    DecisionResult<DecisionResponse>
                > {
                    try {
                        let result: Result<Response>;
                        if (provider === "azure") {
                            result = await callApiWithPool(
                                pool!,
                                async (member) => {
                                    controller.signal.throwIfAborted();
                                    const settings = member.settings;
                                    if (settings.provider !== "azure")
                                        return failure("configuration");
                                    let headers: Record<string, string>;
                                    if (settings.tokenProvider) {
                                        const token =
                                            await settings.tokenProvider.getAccessToken();
                                        controller.signal.throwIfAborted();
                                        if (!token.success)
                                            return failure("authentication");
                                        headers = {
                                            Authorization: `Bearer ${token.data}`,
                                        };
                                    } else
                                        headers = {
                                            "api-key": settings.apiKey,
                                        };
                                    return success({
                                        headers,
                                        body: { model, ...request },
                                    });
                                },
                                {
                                    signal: controller.signal,
                                    overallBudgetMs: timeoutMs,
                                    onAttempt,
                                },
                            );
                        } else {
                            // The helper uses a chat session only to acquire model-specific
                            // credentials. No chat inference or model fallback is used here.
                            endpointProvider ??=
                                createCopilotModelEndpointProvider(
                                    copilotApiSettingsFromConfig(
                                        undefined,
                                        config,
                                    ),
                                    model,
                                );
                            result = await copilotRequest(false);
                            const c = result.success
                                ? undefined
                                : (otel.readTelemetryErrorClassification(
                                      result,
                                  ) ??
                                  otel.classifyTelemetryErrorIfRecognized(
                                      result,
                                  ));
                            if (c?.httpStatus === 401 || c?.httpStatus === 403)
                                result = await copilotRequest(true);
                        }
                        controller.signal.throwIfAborted();
                        if (!result.success) {
                            const c =
                                otel.readTelemetryErrorClassification(result) ??
                                otel.classifyTelemetryErrorIfRecognized(result);
                            return failure(classificationCode(c), c);
                        }
                        let payload: unknown;
                        try {
                            payload = await result.data.json();
                        } catch {
                            return failure("invalid_response");
                        }
                        controller.signal.throwIfAborted();
                        const answers = normalizeDecisionAnswers(
                            payload,
                            request.questions,
                            provider,
                        );
                        const value = payload as Record<string, unknown>;
                        const decisionUsage = normalizeDecisionUsage(
                            value.usage,
                        );
                        const usage = normalizeUsage(decisionUsage);
                        if (usage)
                            TokenCounter.getInstance().add(usage, [
                                "decision",
                                `decision:${provider}`,
                            ]);
                        return success({
                            answers,
                            requestedModel: model,
                            provider,
                            ...(typeof value.model === "string"
                                ? { reportedModel: value.model }
                                : {}),
                            ...(usage ? { usage } : {}),
                            ...(decisionUsage ? { decisionUsage } : {}),
                            timing: { durationMs: performance.now() - started },
                        });
                    } catch (cause) {
                        if (controller.signal.aborted)
                            return failure(
                                options?.signal?.aborted
                                    ? "cancelled"
                                    : "timeout",
                            );
                        if (cause instanceof DecisionValidationError)
                            return failure(cause.code);
                        if (cause instanceof RequestAdmissionError)
                            return failure("budget");
                        if (cause instanceof CopilotEndpointUnavailableError)
                            return failure("unavailable");
                        const c =
                            otel.classifyTelemetryErrorIfRecognized(cause);
                        return failure(classificationCode(c), c);
                    }
                }

                async function copilotRequest(
                    force: boolean,
                ): Promise<Result<Response>> {
                    controller.signal.throwIfAborted();
                    const endpoint = await endpointProvider!.getEndpoint(force);
                    controller.signal.throwIfAborted();
                    const url = new URL("/v1/decisions", endpoint.baseUrl);
                    if (!safeUrl(new URL(endpoint.baseUrl)) || !safeUrl(url))
                        throw new DecisionValidationError("configuration");
                    const settings = {
                        ...copilotApiSettingsFromConfig(undefined, config),
                        endpoint: url.href,
                        modelType: ModelType.Decision as const,
                        timeout: timeoutMs,
                        requestConstraints: config.modelRequestConstraints?.get(
                            `copilot:decision:${model}`.toLowerCase(),
                        ),
                    };
                    return callApiWithPool(
                        makeSingleMemberPool(
                            settings,
                            `copilot:decision:${model}`,
                        ),
                        async () => {
                            controller.signal.throwIfAborted();
                            return success({
                                headers: {
                                    ...endpoint.headers,
                                    Accept: "application/json",
                                },
                                body: buildCopilotDecisionRequest(
                                    model,
                                    request,
                                ),
                            });
                        },
                        {
                            signal: controller.signal,
                            overallBudgetMs: timeoutMs,
                            onAttempt,
                        },
                    );
                }
            },
        });
    } catch (cause) {
        return failure(
            cause instanceof DecisionValidationError
                ? cause.code
                : "configuration",
        );
    }
}

function resolveDecisionProvider(
    config: Config,
    explicit?: DecisionProvider,
): {
    provider: DecisionProvider;
    providerSource: DecisionModel["providerSource"];
} {
    const decision = config.decision?.provider;
    const override = getModelProviderOverride();
    const selections: [string | undefined, DecisionModel["providerSource"]][] =
        [
            [explicit, "factory"],
            [decision === "inherit" ? undefined : decision, "decision"],
            [override, "override"],
            [config.modelProvider, "config"],
            ["azure", "default"],
        ];
    const [provider, providerSource] = selections.find(
        ([value]) => value !== undefined,
    )!;
    if (provider !== "azure" && provider !== "copilot")
        throw new DecisionValidationError("unavailable");
    return { provider, providerSource };
}

function resolveDecisionModelName(
    config: Config,
    provider: DecisionProvider,
): string {
    const model =
        provider === "azure"
            ? (config.decision?.azure?.deploymentName ?? "decision-1")
            : (config.decision?.copilot?.model ?? "gpt-6-luna-decisions");
    if (!nonempty(model)) throw new DecisionValidationError("configuration");
    return model;
}

function createAzureDecisionPool(config: Config): EndpointPool {
    const key = config.decision?.azure?.deploymentKey ?? "decision_1";
    if (!config.azureOpenAI.deployments.has(key))
        throw new DecisionValidationError("unavailable");
    const pool = discoverEndpointPoolFromConfig(
        config,
        "azure",
        ModelType.Decision,
        key,
    );
    if (!pool.members.length) throw new DecisionValidationError("unavailable");
    for (const member of pool.members) {
        const url = new URL(member.settings.endpoint);
        if (
            !safeUrl(url) ||
            url.pathname !== "/providers/microsoft/v1/systemone"
        )
            throw new DecisionValidationError("configuration");
    }
    return pool;
}

function safeUrl(url: URL): boolean {
    return (
        url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
}

function classificationCode(
    c: otel.TelemetryErrorClassification | undefined,
): DecisionFailureCode {
    return c?.errorCategory === "validation"
        ? "invalid_request"
        : !c || c.errorCategory === "internal"
          ? "provider"
          : c.errorCategory;
}

class DecisionValidationError extends Error {
    constructor(readonly code: DecisionFailureCode = "invalid_response") {
        super(code);
    }
}
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalid(): never {
    throw new DecisionValidationError();
}
function nonempty(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}
function hasOwn(value: object, key: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function probability(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
    );
}

export function validateDecisionRequest(request: DecisionRequest): void {
    const seen = new Set<object>();
    function json(value: unknown): boolean {
        if (
            value === null ||
            typeof value === "string" ||
            typeof value === "boolean"
        )
            return true;
        if (typeof value === "number") return Number.isFinite(value);
        if (typeof value !== "object" || seen.has(value)) return false;
        const proto = Object.getPrototypeOf(value);
        if (
            !Array.isArray(value) &&
            proto !== Object.prototype &&
            proto !== null
        )
            return false;
        seen.add(value);
        const valid = Object.values(value).every(json);
        seen.delete(value);
        return valid;
    }
    if (
        !record(request) ||
        !(typeof request.state === "string" || record(request.state)) ||
        !json(request.state) ||
        !record(request.questions) ||
        !Object.keys(request.questions).length
    )
        invalid();
    for (const [name, q] of Object.entries(request.questions)) {
        if (!nonempty(name) || !record(q) || !nonempty(q.instructions))
            invalid();
        switch (q.type) {
            case "noul":
                if (
                    q.criteria !== undefined &&
                    (!record(q.criteria) ||
                        Object.entries(q.criteria).some(
                            ([key, value]) =>
                                !["true", "false"].includes(key) ||
                                !nonempty(value),
                        ))
                )
                    invalid();
                break;
            case "choice":
                if (
                    !record(q.criteria) ||
                    !Object.keys(q.criteria).length ||
                    Object.entries(q.criteria).some(
                        ([key, value]) => !nonempty(key) || !nonempty(value),
                    )
                )
                    invalid();
                break;
            case "score":
                if (
                    !Array.isArray(q.criteria) ||
                    !q.criteria.length ||
                    !Array.from(q.criteria).every(nonempty)
                )
                    invalid();
                break;
            default:
                invalid();
        }
    }
}

export function buildCopilotDecisionRequest(
    model: string,
    request: DecisionRequest,
): object {
    return {
        model,
        input:
            typeof request.state === "string"
                ? request.state
                : JSON.stringify(request.state),
        questions: Object.entries(request.questions).map(([name, q]) => {
            let instructions = q.instructions;
            if (q.type === "noul" && q.criteria) {
                instructions += `\n${JSON.stringify(q.criteria)}`;
            }
            const common = { name, instructions };
            switch (q.type) {
                case "noul":
                    return { ...common, type: "predicate" };
                case "choice":
                    return {
                        ...common,
                        type: "choice",
                        choices: Object.entries(q.criteria).map(
                            ([value, description]) => ({ value, description }),
                        ),
                    };
                case "score":
                    return {
                        ...common,
                        type: "score",
                        levels: q.criteria.map((label) => ({
                            label,
                            description: label,
                        })),
                    };
            }
        }),
    };
}

export function normalizeDecisionAnswers(
    payload: unknown,
    questions: DecisionRequest["questions"],
    provider: DecisionProvider,
): Record<string, DecisionAnswer> {
    if (!record(payload)) invalid();
    const answers =
        provider === "copilot"
            ? decodeCopilotAnswers(payload.answers, questions)
            : payload.answers;
    if (!record(answers)) invalid();
    if (
        Object.keys(answers).length !== Object.keys(questions).length ||
        Object.keys(answers).some((key) => !hasOwn(questions, key))
    )
        invalid();
    return Object.fromEntries(
        Object.entries(questions).map(([name, question]) => [
            name,
            validateDecisionAnswer(answers[name], question),
        ]),
    );
}

function decodeCopilotAnswers(
    value: unknown,
    questions: DecisionRequest["questions"],
): Record<string, unknown> {
    if (!Array.isArray(value)) invalid();
    const names = new Set<string>();
    return Object.fromEntries(
        value.map((answer) => {
            if (
                !record(answer) ||
                !nonempty(answer.name) ||
                names.has(answer.name) ||
                !hasOwn(questions, answer.name)
            )
                invalid();
            names.add(answer.name);
            if (answer.type === "refusal")
                throw new DecisionValidationError("refused");
            if (answer.type === "predicate")
                return [
                    answer.name,
                    {
                        type: "noul",
                        noul: answer.probability,
                        ...nativeConfidence(answer),
                    },
                ];
            return [answer.name, decodeCopilotDistributionAnswer(answer)];
        }),
    );
}

function decodeCopilotDistributionAnswer(
    answer: Record<string, unknown>,
): object {
    if (
        (answer.type !== "choice" && answer.type !== "score") ||
        !Array.isArray(answer.probabilities)
    )
        invalid();
    const values = new Set<string | number>();
    const probabilities = Object.fromEntries(
        answer.probabilities.map((entry: unknown) => {
            if (!record(entry)) invalid();
            const value = copilotDistributionValue(
                entry.value,
                answer.type === "score",
            );
            if (values.has(value)) invalid();
            values.add(value);
            return [String(value), entry.probability];
        }),
    );
    return {
        type: answer.type,
        choice: answer.choice,
        score: answer.score,
        probabilities,
        ...nativeConfidence(answer),
    };
}

function copilotDistributionValue(
    value: unknown,
    score: boolean,
): string | number {
    if (score) {
        if (typeof value !== "number" || !Number.isSafeInteger(value))
            invalid();
        return value;
    }
    if (typeof value !== "string") invalid();
    return value;
}

function validateDistribution(
    value: unknown,
    keys: string[],
): Record<string, number> {
    if (
        !record(value) ||
        Object.keys(value).length !== keys.length ||
        Object.keys(value).some((key) => !keys.includes(key))
    )
        invalid();
    const entries = keys.map((key): [string, number] => {
        const item = value[key];
        if (!hasOwn(value, key) || !probability(item)) invalid();
        return [key, item];
    });
    if (
        Math.abs(
            entries.reduce((total, [, probability]) => total + probability, 0) -
                1,
        ) > 1e-6
    )
        invalid();
    return Object.fromEntries(entries);
}

function validateDecisionAnswer(
    answer: unknown,
    question: DecisionQuestion,
): DecisionAnswer {
    if (record(answer) && answer.type === "refusal")
        throw new DecisionValidationError("refused");
    if (!record(answer) || answer.type !== question.type) invalid();
    const confidence = nativeConfidence(answer);
    if (question.type === "noul") {
        if (!probability(answer.noul)) invalid();
        return { type: "noul", noul: answer.noul, ...confidence };
    }
    const keys =
        question.type === "choice"
            ? Object.keys(question.criteria)
            : question.criteria.map((_, index) => String(index));
    const probabilities = validateDistribution(answer.probabilities, keys);
    if (question.type === "choice") {
        if (
            typeof answer.choice !== "string" ||
            !hasOwn(question.criteria, answer.choice)
        )
            invalid();
        return {
            type: "choice",
            choice: answer.choice,
            probabilities,
            ...confidence,
        };
    }
    if (
        typeof answer.score !== "number" ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > question.criteria.length - 1
    )
        invalid();
    return { type: "score", score: answer.score, probabilities, ...confidence };
}

function nativeConfidence(answer: Record<string, unknown>): {
    confidence?: number;
} {
    if (!hasOwn(answer, "confidence")) return {};
    if (!probability(answer.confidence)) invalid();
    return { confidence: answer.confidence };
}

function normalizeDecisionUsage(value: unknown): DecisionUsage | undefined {
    if (!record(value)) return undefined;
    const details = value.prompt_tokens_details;
    const counts: [keyof CompletionUsageStats, unknown][] = [
        ["prompt_tokens", value.prompt_tokens ?? value.input_tokens],
        ["completion_tokens", value.completion_tokens ?? value.output_tokens],
        ["total_tokens", value.total_tokens],
        [
            "cached_tokens",
            value.cached_tokens ??
                (record(details) ? details.cached_tokens : undefined),
        ],
    ];
    const entries = counts.filter(
        (entry): entry is [keyof CompletionUsageStats, number] =>
            typeof entry[1] === "number" &&
            Number.isSafeInteger(entry[1]) &&
            entry[1] >= 0,
    );
    return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeUsage(
    value: DecisionUsage | undefined,
): CompletionUsageStats | undefined {
    if (
        value?.prompt_tokens === undefined ||
        value.completion_tokens === undefined
    )
        return undefined;
    const prompt = value.prompt_tokens;
    const completion = value.completion_tokens;
    const cached = value.cached_tokens;
    return {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: value.total_tokens ?? prompt + completion,
        ...(cached !== undefined && cached <= prompt
            ? { cached_tokens: cached }
            : {}),
    };
}

function startDecisionSpan(
    provider: DecisionProvider,
    model: string,
    source: DecisionModel["providerSource"],
    count: number,
): Span | undefined {
    try {
        const span = trace
            .getTracer(
                otel.INSTRUMENTATION_SCOPE_NAME,
                otel.INSTRUMENTATION_SCOPE_VERSION,
            )
            .startSpan("typeagent.decision");
        span.setAttributes({
            "gen_ai.operation.name": "decision",
            "gen_ai.provider.name": provider,
            "typeagent.decision.provider_source": source,
            "typeagent.decision.question_count": count,
        });
        if (/^[\w.-]{1,128}$/.test(model))
            span.setAttribute("gen_ai.request.model", model);
        return span;
    } catch {
        return undefined;
    }
}

function finishDecisionSpan(
    span: Span | undefined,
    result: DecisionResult<DecisionResponse>,
    durationMs: number,
    attempts: number,
    regions: string[],
): void {
    try {
        if (!span) return;
        span.setAttributes({
            "typeagent.decision.duration_ms": durationMs,
            "typeagent.decision.transport_attempts": attempts,
            "typeagent.decision.resource_regions": regions,
            "typeagent.decision.outcome": result.success
                ? "success"
                : result.code,
        });
        if (result.success) {
            const usage = result.data.decisionUsage ?? result.data.usage;
            if (usage?.prompt_tokens !== undefined)
                span.setAttribute(
                    "gen_ai.usage.input_tokens",
                    usage.prompt_tokens,
                );
            if (usage?.completion_tokens !== undefined)
                span.setAttribute(
                    "gen_ai.usage.output_tokens",
                    usage.completion_tokens,
                );
            const model = result.data.reportedModel;
            if (model && /^[\w.-]{1,128}$/.test(model))
                span.setAttribute("gen_ai.response.model", model);
            span.setStatus({ code: SpanStatusCode.OK });
        } else {
            span.setAttributes({
                "error.type": result.errorCategory,
                "typeagent.decision.retryable": result.retryable,
            });
            if (result.httpStatus !== undefined)
                span.setAttribute(
                    "http.response.status_code",
                    result.httpStatus,
                );
            span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end();
    } catch {
        /* Telemetry must not change the inference outcome. */
    }
}
