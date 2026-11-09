// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, type RequestBudgetLimits } from "@typeagent/aiclient";
import { countDocTokens } from "@typeagent/conversation-memory";

/** Explicit rehearsal configuration; product initialization never reads this. */
export function resolveConfiguredWikiBudget(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    endpoint?: string,
): RequestBudgetLimits | undefined {
    return [
        environment.MEMORY_WIKI_CONTEXT_TOKENS,
        environment.MEMORY_WIKI_OUTPUT_TOKENS,
        environment.MEMORY_WIKI_TOKENIZER,
    ].some((value) => value !== undefined)
        ? resolveReviewedWikiBudget(environment, endpoint)
        : undefined;
}

export function resolveReviewedWikiBudget(
    environment: Readonly<Record<string, string | undefined>> = process.env,
    endpoint?: string,
): RequestBudgetLimits {
    const capacities = [openai.GPT_6_LUNA, endpoint].map(
        (name) => openai.getChatModelSettings(name).requestConstraints,
    );
    if (
        capacities.some(
            (capacity) =>
                !capacity?.contextTokens ||
                !capacity.outputTokens ||
                !Number.isSafeInteger(capacity.contextTokens) ||
                !Number.isSafeInteger(capacity.outputTokens) ||
                capacity.contextTokens <= capacity.outputTokens,
        )
    )
        throw new Error(
            "Uncapped wiki budgeting requires verified context and output capacity for every selected model",
        );
    const providerOutput = Math.max(
        ...capacities.map((capacity) => capacity!.outputTokens!),
    );
    const providerContext = Math.max(
        ...capacities.map((capacity) => capacity!.contextTokens!),
    );
    const contextTokens =
        environment.MEMORY_WIKI_CONTEXT_TOKENS === undefined
            ? providerContext
            : Number(environment.MEMORY_WIKI_CONTEXT_TOKENS);
    const declaredOutput = Number(
        environment.MEMORY_WIKI_OUTPUT_TOKENS ?? providerOutput,
    );
    const outputTokens = declaredOutput;
    const inputTokens = Math.min(
        16000,
        contextTokens - providerOutput - 1000,
        ...capacities.map(
            (capacity) =>
                capacity!.contextTokens! - capacity!.outputTokens! - 1000,
        ),
        ...capacities.map((capacity) => capacity!.inputTokens ?? 16000),
    );
    if (
        (contextTokens !== undefined &&
            (!Number.isSafeInteger(contextTokens) || contextTokens < 1)) ||
        !Number.isSafeInteger(declaredOutput) ||
        declaredOutput < 1 ||
        inputTokens < 1 ||
        (environment.MEMORY_WIKI_TOKENIZER !== undefined &&
            environment.MEMORY_WIKI_TOKENIZER !== "o200k_base")
    )
        throw new Error(
            "Memory wiki budget overrides must have positive context/output limits and a supported MEMORY_WIKI_TOKENIZER estimator",
        );
    if (declaredOutput < providerOutput || contextTokens > providerContext)
        throw new Error(
            "Reviewed wiki limits are incompatible with uncapped provider capacity; output must reserve the full selected model capacity and context cannot exceed it",
        );
    return {
        contextTokens,
        inputTokens,
        embeddingInputTokens: 300000,
        outputTokens,
        safetyTokens: 1000,
        chatAttempts: 24,
        inputReservedTokens: 160000,
        reservedTokens: 160000 + 24 * outputTokens,
        embeddingAttempts: 128,
        elapsedMs: 600000,
        tokenizer: "o200k_base-estimate",
        countTokens: countDocTokens,
    };
}
