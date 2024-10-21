// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CompletionUsageStats } from "./openai.js";

/**
 *  Token counter for LLM calls.
 *  Counter has total counts and counts grouped by tags
 *  along with other stats like max, min, average, etc. 
 */
export class TokenCounter {
    private static instance: TokenCounter;
    private counters: Map<string, CompletionUsageStats>;
    private totals: CompletionUsageStats = { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0};
    private numSamples: number = 0;
    private maxUsage: CompletionUsageStats = { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0};

    // TODO: intermittently cache these with the session
    private constructor() {
        this.counters = new Map<string, CompletionUsageStats>(); 
    }

    public static getInstance = (): TokenCounter => {
        if (!TokenCounter.instance) {
            TokenCounter.instance = new TokenCounter();
        }

        return TokenCounter.instance;
    }

    /**
     * Counts the supplied totken counts 
     * @param tokens - the tokens to count
     * @param tags - the tags to which the tokens apply (if any)
     */
    add(tokens: CompletionUsageStats, tags?: string[]) {
        // bump the totals
        this.totals.total_tokens += tokens.total_tokens;
        this.totals.completion_tokens += tokens.completion_tokens;
        this.totals.prompt_tokens += tokens.prompt_tokens;

        // bump the counts for the supplied tags
        tags?.map((t) => {
            let updatedCount: CompletionUsageStats = { completion_tokens: tokens.completion_tokens, 
                prompt_tokens: tokens.prompt_tokens, 
                total_tokens: tokens.total_tokens
            };

            if (this.counters.has(t)) {
                updatedCount.completion_tokens += tokens.completion_tokens;
                updatedCount.prompt_tokens += tokens.prompt_tokens;
                updatedCount.total_tokens += tokens.total_tokens;
            }

            this.counters.set(t, updatedCount)
        });

        this.numSamples++;

        if (tokens.total_tokens > this.maxUsage.total_tokens) {
            this.maxUsage.completion_tokens = tokens.completion_tokens;
            this.maxUsage.prompt_tokens = tokens.prompt_tokens;
            this.maxUsage.total_tokens = tokens.total_tokens;
        }

        console.log("Token Odometer: " + JSON.stringify(this.totals) + "\nAverage Tokens per call: " + (this.totals.total_tokens / this.numSamples).toFixed(0));
    }

    public get total(): CompletionUsageStats {
        return { completion_tokens: this.totals.completion_tokens, prompt_tokens: this.totals.prompt_tokens, total_tokens: this.totals.total_tokens };
    }

    public get average(): CompletionUsageStats {
        return { completion_tokens: this.totals.completion_tokens / this.numSamples, prompt_tokens: this.totals.prompt_tokens / this.numSamples, total_tokens: this.totals.total_tokens / this.numSamples };
    }

    public get maximum(): CompletionUsageStats {
        return { completion_tokens: this.maxUsage.completion_tokens, prompt_tokens: this.maxUsage.prompt_tokens, total_tokens: this.maxUsage.total_tokens };
    }
}