// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CompletionUsageStats } from "./openai.js";
import registerDebug from "debug";

const debugTokens = registerDebug("typeagent:tokenCounter");

type TokenStats = {
    max: CompletionUsageStats;
    total: CompletionUsageStats;
    count: number;
};

function initTokenStats(): TokenStats {
    return {
        max: { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0 },
        total: { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0 },
        count: 0,
    };
}

function updateStats(data: TokenStats, tokens: CompletionUsageStats) {
    data.total.completion_tokens += tokens.completion_tokens;
    data.total.prompt_tokens += tokens.prompt_tokens;
    data.total.total_tokens += tokens.total_tokens;
    data.count++;

    data.max.completion_tokens = Math.max(
        data.max.completion_tokens,
        tokens.completion_tokens,
    );
    data.max.prompt_tokens = Math.max(
        data.max.prompt_tokens,
        tokens.prompt_tokens,
    );
    data.max.total_tokens = Math.max(
        data.max.total_tokens,
        tokens.total_tokens,
    );
}

export type TokenCounterData = {
    counters: Record<string, TokenStats>;
    all: TokenStats;
};

/**
 *  Token counter for LLM calls.
 *  Counter has total counts and counts grouped by tags
 *  along with other stats like max, min, average, etc.
 */
export class TokenCounter {
    private static instance: TokenCounter;
    private _counters = new Map<string, TokenStats>();
    private all: TokenStats = initTokenStats();

    // TODO: intermittently cache these with the session
    public static getInstance = (): TokenCounter => {
        if (!TokenCounter.instance) {
            TokenCounter.instance = new TokenCounter();
        }

        return TokenCounter.instance;
    };

    /**
     * Counts the supplied totken counts
     * @param tokens - the tokens to count
     * @param tags - the tags to which the tokens apply (if any)
     */
    add(tokens: CompletionUsageStats, tags?: string[]) {
        // bump the totals
        updateStats(this.all, tokens);

        // bump the counts for the supplied tags
        tags?.map((t) => {
            let data = this._counters.get(t);
            if (data === undefined) {
                data = initTokenStats();
                this._counters.set(t, data);
            }

            updateStats(data, tokens);
        });

        debugTokens("Token Increment: " + JSON.stringify(tokens));

        debugTokens(
            "Token Odometer: " +
                JSON.stringify(this.all.total) +
                "\nAverage Tokens per call: " +
                (this.all.total.total_tokens / this.all.count).toFixed(0),
        );
    }

    public toJSON(): TokenCounterData {
        return {
            counters: Object.fromEntries(this._counters.entries()),
            all: this.all,
        };
    }

    private static fromJSON(json: TokenCounterData) {
        const counter = new TokenCounter();
        if ((json as any).numSamples !== undefined) {
            // old format, ignore
            return counter;
        }
        counter.all = json.all;
        counter._counters = new Map(Object.entries(json.counters));
        return counter;
    }
    /**
     * Gets the # of tokens for the supplied tag.
     * @param tag The tag for which to get the token counts
     * @returns The token usage stats
     */
    public getTokenUsage(tag: string): TokenStats | undefined {
        return this._counters.get(tag);
    }

    /**
     * Sets the token counter to a specific state (i.e. continuing from a previously stored state)
     * @param data the token counter data to load
     */
    public static load(data: TokenCounterData) {
        if ((data as any).numSamples !== undefined) {
            // old format, ignore
            return;
        }
        this.instance = TokenCounter.fromJSON(data);
    }

    public get total(): CompletionUsageStats {
        return {
            completion_tokens: this.all.total.completion_tokens,
            prompt_tokens: this.all.total.prompt_tokens,
            total_tokens: this.all.total.total_tokens,
        };
    }

    public get average(): CompletionUsageStats {
        return {
            completion_tokens:
                this.all.total.completion_tokens / this.all.count,
            prompt_tokens: this.all.total.prompt_tokens / this.all.count,
            total_tokens: this.all.total.total_tokens / this.all.count,
        };
    }

    public get maximum(): CompletionUsageStats {
        return {
            completion_tokens: this.all.max.completion_tokens,
            prompt_tokens: this.all.max.prompt_tokens,
            total_tokens: this.all.max.total_tokens,
        };
    }

    public get counters(): Map<string, TokenStats> {
        return this._counters;
    }
}
