// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { RequestBudgetLimits } from "@typeagent/aiclient";
import { countDocTokens } from "@typeagent/conversation-memory";

/** Explicit rehearsal configuration; product initialization never reads this. */
export function resolveConfiguredWikiBudget(
    environment: Readonly<Record<string, string | undefined>> = process.env,
): RequestBudgetLimits | undefined {
    return [
        environment.MEMORY_WIKI_CONTEXT_TOKENS,
        environment.MEMORY_WIKI_OUTPUT_TOKENS,
        environment.MEMORY_WIKI_TOKENIZER,
    ].some((value) => value !== undefined)
        ? resolveReviewedWikiBudget(environment)
        : undefined;
}

export function resolveReviewedWikiBudget(
    environment: Readonly<Record<string, string | undefined>> = process.env,
): RequestBudgetLimits {
    const contextTokens =
        environment.MEMORY_WIKI_CONTEXT_TOKENS === undefined
            ? undefined
            : Number(environment.MEMORY_WIKI_CONTEXT_TOKENS);
    const declaredOutput = Number(
        environment.MEMORY_WIKI_OUTPUT_TOKENS ?? 4000,
    );
    const outputTokens = Math.min(4000, declaredOutput);
    const inputTokens =
        contextTokens === undefined
            ? 16000
            : Math.min(16000, contextTokens - outputTokens - 1000);
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
    return {
        contextTokens,
        inputTokens,
        embeddingInputTokens: 300000,
        outputTokens,
        safetyTokens: 1000,
        chatAttempts: 24,
        reservedTokens: 160000,
        embeddingAttempts: 128,
        elapsedMs: 600000,
        tokenizer: "o200k_base-estimate",
        countTokens: countDocTokens,
    };
}
