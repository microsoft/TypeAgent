// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { performance } from "node:perf_hooks";
import {
    validateRecipeValue,
    validateRuntimeJsonSchema,
    type JsonValue,
    type RecipeCallContext,
    type RecipeSemanticFunction,
    type RecipeSemanticOutcome,
    type RuntimeJsonSchema,
} from "./recipeCore.js";
import { recipeSemanticContractIdentity } from "./recipeSemanticIdentity.js";

export {
    inspectRecipeSemanticBindingGuard,
    type RecipeSemanticBindingGuard,
    type RecipeSemanticBindingObservation,
} from "./recipeSemanticBinding.js";
export {
    createRecipeRelevanceDefinition,
    createRecipeRelevanceRegistration,
    type RecipeRelevanceInput,
    type RecipeRelevanceOutput,
} from "./recipeSemanticReference.js";

export interface RecipeSemanticProviderRequest {
    definition: RecipeSemanticFunction;
    input: JsonValue;
    attempt: number;
    repair?: { diagnostics: string };
    signal: AbortSignal;
}

// A host supplies an already-approved inference capability, not credentials.
// One complete() is exactly one inference request: no hidden retries, tool
// discovery, planner, or effects. The adapter validates its untrusted response.
export interface ApprovedRecipeSemanticProvider {
    id: string;
    approval: { capabilityId: string; policyRevision: string };
    evidenceKind: "synthetic" | "approved-provider";
    complete(request: RecipeSemanticProviderRequest): Promise<unknown>;
}

export interface RecipeSemanticAttempt {
    attempt: number;
    providerId: string;
    evidenceKind: ApprovedRecipeSemanticProvider["evidenceKind"];
    functionId: string;
    functionRevision: string;
    specification: { id: string; revision: string };
    modelPolicy: { id: string; revision: string };
    latencyMs: number;
    validation: "passed" | "failed" | "not_returned";
    resolvedModel?: string;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    currency?: string;
}

export type RecipeSemanticResult = RecipeSemanticOutcome & {
    attempts: RecipeSemanticAttempt[];
};

export interface RecipeSemanticRegistration {
    definition: RecipeSemanticFunction;
    validateInput?: (input: JsonValue) => string | undefined;
    // Required when evidence obligations are declared. This checks provenance,
    // not the truth of a model's judgment.
    validateEvidence?: (
        input: JsonValue,
        output: JsonValue,
    ) => { sourceIds: string[] } | { error: string };
}

const metadataProperties: Record<string, RuntimeJsonSchema> = {
    resolvedModel: { type: "string", minLength: 1, maxLength: 256 },
    inputTokens: { type: "integer", minimum: 0 },
    outputTokens: { type: "integer", minimum: 0 },
    cost: { type: "number", minimum: 0 },
    currency: { type: "string", minLength: 1, maxLength: 16 },
};

function responseSchema(abstained: boolean): RuntimeJsonSchema {
    return {
        type: "object",
        properties: {
            ...metadataProperties,
            kind: {
                type: "string",
                enum: [abstained ? "abstained" : "json"],
            },
            ...(abstained
                ? {
                      reason: {
                          type: "string" as const,
                          minLength: 1,
                          maxLength: 1024,
                      },
                  }
                : { text: { type: "string" as const } }),
        },
        required: [
            "kind",
            "resolvedModel",
            "inputTokens",
            "outputTokens",
            abstained ? "reason" : "text",
        ],
        additionalProperties: false,
    };
}

interface ProviderResponse {
    kind: "json" | "abstained";
    text?: string;
    reason?: string;
    resolvedModel: string;
    inputTokens: number;
    outputTokens: number;
    cost?: number;
    currency?: string;
}

export function assertRecipeSemanticRegistration(
    registration: RecipeSemanticRegistration,
): void {
    const { definition: d } = registration;
    const versions = [
        d.id,
        d.revision,
        d.specification.id,
        d.specification.revision,
        d.specification.task,
        d.specification.rubric,
        d.modelPolicy.id,
        d.modelPolicy.revision,
    ];
    if (versions.some((value) => !value?.trim()))
        throw new Error(
            "Semantic identity, specification, and policy must be versioned.",
        );
    if (
        validateRuntimeJsonSchema(d.inputSchema).length ||
        validateRuntimeJsonSchema(d.outputSchema).length
    )
        throw new Error("Invalid semantic runtime schema.");
    const { maxRepairAttempts } = d.bounds;
    const positiveBounds = [
        d.bounds.timeoutMs,
        d.bounds.maxInputBytes,
        d.bounds.maxOutputBytes,
        d.bounds.maxCalls,
        d.bounds.maxConcurrency,
    ];
    if (
        positiveBounds.some(
            (value) => !Number.isSafeInteger(value) || value <= 0,
        ) ||
        !Number.isSafeInteger(maxRepairAttempts) ||
        maxRepairAttempts < 0 ||
        d.bounds.timeoutMs > 2_147_483_647
    )
        throw new Error("Semantic bounds must be finite supported integers.");
    if (
        (d.evidence.sourceIds !== "none" || d.evidence.quotations) &&
        !registration.validateEvidence
    )
        throw new Error(
            "Declared semantic evidence requires a provenance validator.",
        );
}

function jsonSize(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function errorOutcome(
    status:
        | "invalid_input"
        | "invalid_output"
        | "provider_error"
        | "limit_exceeded"
        | "cancelled"
        | "unsupported",
    message: string,
): RecipeSemanticOutcome {
    return { status, message };
}

export class RecipeSemanticAdapter {
    private readonly registration: RecipeSemanticRegistration;
    private readonly started = new WeakMap<RecipeSemanticAttempt, number>();
    private active = 0;

    constructor(
        registration: RecipeSemanticRegistration,
        private readonly provider?: ApprovedRecipeSemanticProvider,
    ) {
        assertRecipeSemanticRegistration(registration);
        this.registration = {
            ...registration,
            definition: structuredClone(registration.definition),
        };
        if (
            provider &&
            (!provider.id.trim() ||
                !provider.approval.capabilityId.trim() ||
                !provider.approval.policyRevision.trim() ||
                !["synthetic", "approved-provider"].includes(
                    provider.evidenceKind,
                ))
        )
            throw new Error(
                "An explicitly approved provider contract is required.",
            );
    }

    async invokeSemantic(
        definition: RecipeSemanticFunction,
        input: JsonValue,
        context: RecipeCallContext,
    ): Promise<RecipeSemanticResult> {
        const attempts: RecipeSemanticAttempt[] = [];
        const preflight = this.preflight(definition, input, context);
        if (preflight) return { ...preflight, attempts };
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancel: () => void = () => {};
        const stopped = new Promise<RecipeSemanticOutcome>((resolve) => {
            cancel = () => {
                controller.abort();
                resolve(
                    errorOutcome(
                        "cancelled",
                        "Semantic call cancelled; late results suppressed.",
                    ),
                );
            };
            context.signal.addEventListener("abort", cancel, { once: true });
            timer = setTimeout(() => {
                controller.abort();
                resolve(
                    errorOutcome(
                        "limit_exceeded",
                        "Semantic timeout; late results suppressed.",
                    ),
                );
            }, definition.bounds.timeoutMs);
        });
        try {
            // Snapshot caller-controlled values before the first asynchronous boundary.
            const work = this.execute(
                structuredClone(input),
                controller.signal,
                attempts,
            );
            const outcome = await Promise.race([work, stopped]);
            return {
                ...outcome,
                attempts: structuredClone(
                    attempts.map((attempt) => ({
                        ...attempt,
                        latencyMs:
                            attempt.validation === "not_returned" &&
                            attempt.latencyMs === 0
                                ? performance.now() - this.started.get(attempt)!
                                : attempt.latencyMs,
                    })),
                ),
            };
        } finally {
            clearTimeout(timer);
            context.signal.removeEventListener("abort", cancel);
        }
    }

    private preflight(
        definition: RecipeSemanticFunction,
        input: JsonValue,
        context: RecipeCallContext,
    ): RecipeSemanticOutcome | undefined {
        if (context.signal.aborted)
            return errorOutcome(
                "cancelled",
                "Semantic call cancelled before scheduling.",
            );
        if (
            recipeSemanticContractIdentity(definition) !==
            recipeSemanticContractIdentity(this.registration.definition)
        )
            return errorOutcome(
                "unsupported",
                "Semantic definition does not match its immutable registration.",
            );
        if (!this.provider)
            return errorOutcome(
                "unsupported",
                "P0 blocked: no approved host inference provider has been injected.",
            );
        try {
            if (validateRecipeValue(definition.inputSchema, input).length)
                return errorOutcome(
                    "invalid_input",
                    "Semantic input schema mismatch.",
                );
            if (jsonSize(input) > definition.bounds.maxInputBytes)
                return errorOutcome(
                    "limit_exceeded",
                    "Semantic input byte limit exceeded.",
                );
            const error = this.registration.validateInput?.(input);
            if (error) return errorOutcome("invalid_input", error);
        } catch {
            return errorOutcome(
                "invalid_input",
                "Semantic input must be valid bounded JSON.",
            );
        }
        if (this.active >= definition.bounds.maxConcurrency)
            return errorOutcome(
                "limit_exceeded",
                "Semantic provider concurrency limit exceeded.",
            );
        return undefined;
    }

    private async execute(
        input: JsonValue,
        signal: AbortSignal,
        attempts: RecipeSemanticAttempt[],
    ): Promise<RecipeSemanticOutcome> {
        const { definition } = this.registration;
        let diagnostics: string | undefined;
        for (
            let index = 0;
            index <= definition.bounds.maxRepairAttempts;
            index++
        ) {
            if (signal.aborted)
                return errorOutcome(
                    "cancelled",
                    "Late semantic result suppressed.",
                );
            if (index >= definition.bounds.maxCalls)
                return errorOutcome(
                    "limit_exceeded",
                    "Semantic inference call limit exhausted.",
                );
            const result = await this.call(
                input,
                index,
                diagnostics,
                signal,
                attempts,
            );
            if (signal.aborted)
                return errorOutcome(
                    "cancelled",
                    "Late semantic result suppressed.",
                );
            if (result.status !== "invalid_output") return result;
            diagnostics = result.message;
        }
        return errorOutcome("invalid_output", diagnostics!);
    }

    private async call(
        input: JsonValue,
        attempt: number,
        diagnostics: string | undefined,
        signal: AbortSignal,
        attempts: RecipeSemanticAttempt[],
    ): Promise<RecipeSemanticOutcome> {
        const { definition } = this.registration;
        // A timed-out provider that ignores abort retains its slot until it
        // settles. Otherwise repeated timeouts could exceed real concurrency.
        if (this.active >= definition.bounds.maxConcurrency)
            return errorOutcome(
                "limit_exceeded",
                "Semantic provider concurrency limit exceeded.",
            );
        this.active++;
        const started = performance.now();
        const observation: RecipeSemanticAttempt = {
            attempt,
            providerId: this.provider!.id,
            evidenceKind: this.provider!.evidenceKind,
            functionId: definition.id,
            functionRevision: definition.revision,
            specification: {
                id: definition.specification.id,
                revision: definition.specification.revision,
            },
            modelPolicy: { ...definition.modelPolicy },
            latencyMs: 0,
            validation: "not_returned",
        };
        attempts.push(observation);
        this.started.set(observation, started);
        try {
            const response = await this.provider!.complete({
                definition: structuredClone(definition),
                input: structuredClone(input),
                attempt,
                ...(diagnostics ? { repair: { diagnostics } } : {}),
                signal,
            });
            observation.latencyMs = performance.now() - started;
            if (signal.aborted)
                return errorOutcome(
                    "cancelled",
                    "Late semantic result suppressed.",
                );
            return this.validateResponse(response, input, observation);
        } catch {
            observation.latencyMs = performance.now() - started;
            return errorOutcome(
                "provider_error",
                "Approved semantic provider failed.",
            );
        } finally {
            this.active--;
        }
    }

    private validateResponse(
        response: unknown,
        input: JsonValue,
        observation: RecipeSemanticAttempt,
    ): RecipeSemanticOutcome {
        const { definition } = this.registration;
        observation.validation = "failed";
        const abstained =
            typeof response === "object" &&
            response !== null &&
            "kind" in response &&
            response.kind === "abstained";
        if (validateRecipeValue(responseSchema(abstained), response).length)
            return errorOutcome(
                "invalid_output",
                "Malformed provider envelope or missing resolved model/usage evidence.",
            );
        const result = response as ProviderResponse;
        if (
            !result.resolvedModel.trim() ||
            (abstained && !result.reason!.trim()) ||
            (result.cost !== undefined && !result.currency?.trim())
        )
            return errorOutcome(
                "invalid_output",
                "Provider model, abstention reason, and cost units must be explicit.",
            );
        Object.assign(observation, {
            resolvedModel: result.resolvedModel,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            ...(result.cost === undefined ? {} : { cost: result.cost }),
            ...(result.currency === undefined
                ? {}
                : { currency: result.currency }),
        });
        if (jsonSize(response) > definition.bounds.maxOutputBytes)
            return errorOutcome(
                "limit_exceeded",
                "Semantic output byte limit exceeded.",
            );
        if (abstained) {
            observation.validation = "passed";
            return { status: "abstained", reason: result.reason! };
        }
        let output: JsonValue;
        try {
            output = JSON.parse(result.text!);
        } catch {
            return errorOutcome(
                "invalid_output",
                "Semantic output is not strict JSON.",
            );
        }
        if (validateRecipeValue(definition.outputSchema, output).length)
            return errorOutcome(
                "invalid_output",
                "Semantic output schema mismatch.",
            );
        const provenance = this.registration.validateEvidence?.(input, output);
        if (provenance && "error" in provenance)
            return errorOutcome("invalid_output", provenance.error);
        observation.validation = "passed";
        return {
            status: "completed",
            value: output,
            evidence: {
                functionId: definition.id,
                functionRevision: definition.revision,
                resolvedModel: result.resolvedModel,
                latencyMs: observation.latencyMs,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                validation: "passed",
                sourceIds: provenance?.sourceIds ?? [],
            },
        };
    }
}
