// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    RequestBudget,
    runWithRequestBudget,
    runWithRequestAttemptObserver,
    type DecisionRequest,
    type DecisionResponse,
    type RequestAttemptObserver,
    type RequestBudgetLimits,
} from "@typeagent/aiclient";
import { randomUUID } from "node:crypto";
import {
    yieldMaintenanceBuild,
    type MaintenanceModelScheduler,
} from "./maintenanceConcurrency.js";
import { viewHash } from "./viewContent.js";
import {
    assertViewJson,
    type ViewExtensionRegistry,
} from "./viewExtensions.js";
import type { ViewBuildSnapshot, ViewBuildTargetResult } from "./viewTypes.js";
import type {
    ViewExtensionProvider,
    ViewJsonValue,
    ViewProviderContext,
} from "./viewExtensionTypes.js";

export interface ExtensionExecutionOptions {
    input: ViewBuildSnapshot;
    result: ViewBuildTargetResult;
    provider: ViewExtensionProvider;
    registry: ViewExtensionRegistry;
    signal: AbortSignal;
    requestBudget?: RequestBudgetLimits | undefined;
    models: MaintenanceModelScheduler;
    update(
        operation: (target: ViewBuildTargetResult) => void,
        finishing?: boolean,
    ): Promise<void>;
    errorText(error: unknown): string;
    assertEligible?(): Promise<void>;
}

function cumulativeElapsed(result: ViewBuildTargetResult): number {
    return Math.max(
        0,
        ...(result.providerRequests ?? []).map(
            (entry) =>
                entry.reservation.elapsedMs +
                (entry.elapsedMs ??
                    Math.max(0, Date.now() - Date.parse(entry.at))),
        ),
    );
}

function limitsSnapshot(options: ExtensionExecutionOptions): ViewJsonValue {
    const request = options.requestBudget;
    const original = options.result.providerLimits as
        | { request?: { chatAttempts?: number } }
        | undefined;
    const additional =
        request && original?.request?.chatAttempts !== undefined
            ? Math.max(0, request.chatAttempts - original.request.chatAttempts)
            : 0;
    const { countTokens: _estimator, ...serializable } = request ?? {};
    return JSON.parse(
        JSON.stringify({
            maxModelCalls:
                options.provider.descriptor.limits.maxModelCalls + additional,
            timeoutMs: options.provider.descriptor.limits.timeoutMs,
            request: request ? serializable : null,
        }),
    );
}

function validateAmendment(
    previous: ViewJsonValue,
    current: ViewJsonValue,
): void {
    const before = previous as {
        request: Record<string, unknown> | null;
        timeoutMs: number;
        maxModelCalls: number;
    };
    const after = current as typeof before;
    if (
        before.timeoutMs !== after.timeoutMs ||
        after.maxModelCalls < before.maxModelCalls
    )
        throw new Error(
            "Continuation cannot weaken provider per-run safety or reset cumulative calls",
        );
    if (before.request && after.request) {
        for (const key of [
            "tokenizer",
            "inputTokens",
            "embeddingInputTokens",
            "outputTokens",
            "contextTokens",
            "safetyTokens",
        ])
            if (before.request[key] !== after.request[key])
                throw new Error(
                    "Continuation must retain request safety limits and tokenizer",
                );
        for (const key of [
            "chatAttempts",
            "embeddingAttempts",
            "reservedTokens",
            "inputReservedTokens",
            "elapsedMs",
        ])
            if (
                typeof before.request[key] === "number" &&
                (typeof after.request[key] !== "number" ||
                    (after.request[key] as number) <
                        (before.request[key] as number))
            )
                throw new Error(
                    "Continuation cannot reset or reduce cumulative request limits",
                );
    } else if (viewHash(before.request) !== viewHash(after.request))
        throw new Error(
            "Continuation cannot replace the admitted request-budget contract",
        );
}

function validateStage(stage: string): void {
    if (typeof stage !== "string" || !stage.trim() || stage.length > 200)
        throw new Error("A bounded provider stage identity is required");
}

export async function createExtensionExecution(
    options: ExtensionExecutionOptions,
): Promise<ViewProviderContext> {
    const { input, provider, registry, signal, update, result } = options;
    const limits = limitsSnapshot(options);
    const previous =
        result.providerBudgetAmendments?.at(-1)?.current ??
        result.providerLimits;
    if (previous) validateAmendment(previous, limits);
    await update((target) => {
        if (!target.providerLimits) target.providerLimits = limits;
        else if (viewHash(previous) !== viewHash(limits))
            (target.providerBudgetAmendments ??= []).push({
                at: new Date().toISOString(),
                previous: previous!,
                current: limits,
            });
    });
    const maxCalls = (limits as { maxModelCalls: number }).maxModelCalls;
    const budget = options.requestBudget
        ? new RequestBudget(options.requestBudget, {
              receipts: (result.providerRequests ?? []).map(
                  (entry) => entry.reservation,
              ),
              elapsedMs: Math.max(
                  result.providerBudgetElapsedMs ?? 0,
                  cumulativeElapsed(result),
              ),
          })
        : undefined;
    const completed = [...(result.providerAttempts ?? [])];
    const boundedSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(provider.descriptor.limits.timeoutMs),
    ]);
    const assertEligible = async () => {
        boundedSignal.throwIfAborted();
        await options.assertEligible?.();
        await registry.authorize(input, "build");
        boundedSignal.throwIfAborted();
    };
    const checkpoint = async (stage: string, state?: ViewJsonValue) => {
        validateStage(stage);
        boundedSignal.throwIfAborted();
        await assertEligible();
        if (state !== undefined) assertViewJson(state);
        await update((target) => {
            (target.providerCheckpoints ??= []).push({
                stage,
                at: new Date().toISOString(),
                ...(state === undefined
                    ? {}
                    : { state: structuredClone(state) }),
            });
            if (budget) target.providerBudgetElapsedMs = budget.elapsedMs;
        });
        await yieldMaintenanceBuild(boundedSignal);
    };
    const invoke = async (
        stage: string,
        prompt: unknown,
        schema: unknown,
        call: () => Promise<string>,
        usage: () => ViewJsonValue | undefined,
    ): Promise<string> => {
        validateStage(stage);
        boundedSignal.throwIfAborted();
        await assertEligible();
        const promptFingerprint = viewHash(prompt);
        const schemaFingerprint = viewHash(schema ?? null);
        const cached = completed.find(
            (entry) =>
                entry.state === "returned" &&
                entry.promptFingerprint === promptFingerprint &&
                entry.schemaFingerprint === schemaFingerprint &&
                entry.stage === stage &&
                entry.output !== undefined,
        );
        if (cached) return cached.output!;
        await registry.authorize(input, "model");
        if (!budget)
            throw new Error(
                "Provider model work requires a shared maintenance request budget",
            );
        let attempt = 0;
        await update((target) => {
            const attempts = (target.providerAttempts ??= []);
            if (attempts.length >= maxCalls)
                throw new Error(
                    "Cumulative provider model-call budget exhausted",
                );
            attempt = attempts.length;
            attempts.push({
                stage,
                state: "started",
                promptFingerprint,
                schemaFingerprint,
            });
        });
        const observer = requestObserver(
            options,
            stage,
            attempt,
            boundedSignal,
        );
        try {
            const output = await runWithRequestBudget(budget, () =>
                runWithRequestAttemptObserver(observer, () =>
                    options.models(async () => {
                        await assertEligible();
                        await registry.authorize(input, "model");
                        return call();
                    }, boundedSignal),
                ),
            );
            if (output.length > provider.descriptor.limits.maxOutputChars)
                throw new Error(
                    "Provider stage output exceeds its admitted bound",
                );
            boundedSignal.throwIfAborted();
            await assertEligible();
            await update((target) => {
                const entry = target.providerAttempts![attempt];
                entry.state = "returned";
                entry.output = output;
                target.providerBudgetElapsedMs = budget.elapsedMs;
                const reported = usage();
                if (reported !== undefined) entry.usage = reported;
                completed.push(structuredClone(entry));
            }, true);
            return output;
        } catch (error) {
            await update((target) => {
                const entry = target.providerAttempts![attempt];
                entry.state = "failed";
                entry.reason = options.errorText(error);
                target.providerBudgetElapsedMs = budget.elapsedMs;
            }, true);
            throw error;
        }
    };
    return {
        signal: boundedSignal,
        assertEligible,
        deadline: Date.now() + provider.descriptor.limits.timeoutMs,
        checkpoint,
        ...(completed.length ||
        result.providerCandidates?.length ||
        result.providerCheckpoints?.length
            ? {
                  resume: {
                      candidates: structuredClone(
                          result.providerCandidates ?? [],
                      ),
                      checkpoints: structuredClone(
                          result.providerCheckpoints ?? [],
                      ),
                  },
              }
            : {}),
        async recordCandidate(stage, value) {
            validateStage(stage);
            boundedSignal.throwIfAborted();
            await assertEligible();
            assertViewJson(value);
            if (
                JSON.stringify(value).length >
                provider.descriptor.limits.maxOutputChars
            )
                throw new Error(
                    "Provider candidate exceeds its admitted output bound",
                );
            await update((target) => {
                const fingerprint = viewHash(value);
                const candidates = (target.providerCandidates ??= []);
                if (
                    !candidates.some(
                        (entry) =>
                            entry.stage === stage &&
                            entry.fingerprint === fingerprint,
                    )
                )
                    candidates.push({
                        id: randomUUID(),
                        stage,
                        fingerprint,
                        createdAt: new Date().toISOString(),
                        value: structuredClone(value),
                    });
            });
        },
        complete(stage, prompt, schema) {
            let usage: ViewJsonValue | undefined;
            return invoke(
                stage,
                prompt,
                schema,
                async () => {
                    if (!provider.model)
                        throw new Error("Provider has no admitted chat model");
                    const response = await provider.model.complete(
                        prompt,
                        (stats) => {
                            if (stats !== undefined)
                                usage = JSON.parse(JSON.stringify(stats));
                        },
                        schema,
                        undefined,
                        boundedSignal,
                    );
                    if (!response.success) throw new Error(response.message);
                    return response.data;
                },
                () => usage,
            );
        },
        async decide(
            stage: string,
            request: DecisionRequest,
        ): Promise<DecisionResponse> {
            let usage: ViewJsonValue | undefined;
            const output = await invoke(
                stage,
                request,
                "native-decision-v1",
                async () => {
                    if (!provider.decisionModel)
                        throw new Error(
                            "Provider has no admitted native decision model",
                        );
                    const response = await provider.decisionModel.decide(
                        request,
                        { signal: boundedSignal },
                    );
                    if (!response.success) throw new Error(response.message);
                    usage = JSON.parse(
                        JSON.stringify(
                            response.data.decisionUsage ??
                                response.data.usage ??
                                null,
                        ),
                    );
                    if (usage === null) usage = undefined;
                    return JSON.stringify(response.data);
                },
                () => usage,
            );
            return JSON.parse(output) as DecisionResponse;
        },
    };
}

function requestObserver(
    options: ExtensionExecutionOptions,
    stage: string,
    outerAttempt: number,
    signal: AbortSignal,
): RequestAttemptObserver {
    return {
        async reserve(event) {
            signal.throwIfAborted();
            await options.registry.authorize(options.input, "model");
            const reservation = event.reservations.at(-1);
            if (!reservation)
                throw new Error(
                    "No admitted provider request budget reservation",
                );
            const id = randomUUID();
            await options.update((target) => {
                (target.providerRequests ??= []).push({
                    id,
                    stage,
                    outerAttempt,
                    state: "started",
                    requestFingerprint: event.requestFingerprint,
                    reservation: structuredClone(reservation),
                    at: event.at,
                });
            });
            signal.throwIfAborted();
            await options.registry.authorize(options.input, "model");
            return id;
        },
        async finish(id, outcome) {
            await options.update((target) => {
                const request = target.providerRequests?.find(
                    (entry) => entry.id === id,
                );
                if (!request)
                    throw new Error("Recorded provider request was removed");
                Object.assign(request, {
                    state: outcome.state,
                    finishedAt: outcome.at,
                    elapsedMs: outcome.elapsedMs,
                    ...(outcome.status === undefined
                        ? {}
                        : { status: outcome.status }),
                });
            }, true);
        },
    };
}
