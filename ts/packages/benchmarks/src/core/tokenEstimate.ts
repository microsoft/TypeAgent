// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

// o200k_base is a model-agnostic approximation of prompt-token cost for every
// model the benchmark drives (GPT and non-GPT). It backs the rate limiter's
// pre-flight reservation, which is later settled to actual reported usage; the
// +5% overhead absorbs cross-tokenizer drift so we never underestimate.
export const TOKEN_ESTIMATE_OVERHEAD = 0.05;

export function estimatePromptTokens(text: string): number {
    const base = countTokens(text);
    return Math.ceil(base * (1 + TOKEN_ESTIMATE_OVERHEAD));
}
