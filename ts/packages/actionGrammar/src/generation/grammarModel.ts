// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { openai } from "@typeagent/aiclient";
import { claudeExecutableOption } from "./cliPath.js";

export type GrammarModelProvider = "copilot" | "claude";
export type GrammarModelQuery = (prompt: string) => Promise<string>;

export const defaultGrammarModel = "gpt-5.6-sol";
export const defaultClaudeGrammarModel = "claude-sonnet-4-20250514";

export interface GrammarModelOptions {
    provider?: GrammarModelProvider;
    model?: string;
    query?: GrammarModelQuery;
}

export function resolveGrammarModel(options: GrammarModelOptions): {
    provider: GrammarModelProvider;
    model: string;
} {
    const provider =
        options.provider ??
        (options.model?.toLowerCase().startsWith("claude")
            ? "claude"
            : "copilot");
    return {
        provider,
        model:
            options.model ??
            (provider === "claude"
                ? defaultClaudeGrammarModel
                : defaultGrammarModel),
    };
}

export function createGrammarModelQuery(
    options: GrammarModelOptions = {},
): GrammarModelQuery {
    if (options.query !== undefined) {
        return options.query;
    }

    const { provider, model } = resolveGrammarModel(options);
    return provider === "claude"
        ? (prompt) => queryClaude(prompt, model)
        : (prompt) => queryCopilot(prompt, model);
}

async function queryCopilot(prompt: string, model: string): Promise<string> {
    const result = await openai
        .createChatModel(`copilot:${model}`)
        .complete(prompt);
    if (!result.success) {
        throw new Error(`Copilot grammar generation failed: ${result.message}`);
    }
    return result.data;
}

async function queryClaude(prompt: string, model: string): Promise<string> {
    const queryInstance = query({
        prompt,
        options: { model, ...claudeExecutableOption() },
    });

    for await (const message of queryInstance) {
        if (message.type === "result" && message.subtype === "success") {
            return message.result || "";
        }
    }
    return "";
}
