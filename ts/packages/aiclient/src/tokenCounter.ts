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
    private _tags: string[] = [];
    private _stats: CompletionUsageStats[] = [];

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
            this._tags = Array.from(this.counters.keys());
            this._stats = Array.from(this.counters.values());
        });

        this.numSamples++;

        if (tokens.total_tokens > this.maxUsage.total_tokens) {
            this.maxUsage.completion_tokens = tokens.completion_tokens;
            this.maxUsage.prompt_tokens = tokens.prompt_tokens;
            this.maxUsage.total_tokens = tokens.total_tokens;
        }

        console.log("Token Odometer: " + JSON.stringify(this.totals) + "\nAverage Tokens per call: " + (this.totals.total_tokens / this.numSamples).toFixed(0));
    }

    /**
     * Gets the # of tokens for the supplied tag.
     * @param tag The tag for which to get the token counts
     * @returns The token usage stats
     */
    public getTokenUsage(tag: string): CompletionUsageStats | undefined {
        if (this.counters.has(tag)) {
            return this.counters.get(tag);
        } else {
            return undefined;
        }
    }

    /**
     * Sets the token counter to a specific state (i.e. continuing from a previously stored state)
     * @param data the token counter data to load
     */
    public static load(data: TokenCounter) {
        this.instance = new TokenCounter();
        this.instance.numSamples = data.numSamples;
        this.instance._stats = Array.from(data._stats);
        this.instance._tags = Array.from(data._tags);
        this.instance.maxUsage = data.maxUsage;
        this.instance.totals = data.totals;

        this.instance._tags.forEach((tag, index) => {
            this.instance.counters.set(tag, this.instance._stats[index]);
          });
    }

    public get tags(): string[] {
        return this._tags;
    }

    public get stats(): CompletionUsageStats[] {
        return this._stats;
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