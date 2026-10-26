// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { encode } from "gpt-tokenizer/encoding/cl100k_base";

// Keep a safety margin below the hosted embedding models' 8,192-token limit.
export const maxEmbeddingInputTokens = 8_000;

export function countEmbeddingTokens(text: string): number {
    return encode(text, {
        allowedSpecial: new Set(),
        disallowedSpecial: new Set(),
    }).length;
}

export function embeddingInputLimitError(
    input: string | readonly string[],
): string | undefined {
    const texts = typeof input === "string" ? [input] : input;
    for (let index = 0; index < texts.length; index++) {
        const tokens = countEmbeddingTokens(texts[index]);
        if (tokens > maxEmbeddingInputTokens) {
            return `Embedding input[${index}] has ${tokens} tokens; maximum is ${maxEmbeddingInputTokens} (cl100k_base)`;
        }
    }
    return undefined;
}
