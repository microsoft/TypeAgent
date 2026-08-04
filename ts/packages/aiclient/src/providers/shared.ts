// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared helpers used by multiple wire adapters and by non-chat paths
 * in openai.ts (image/embedding/video). Dependency is one-directional:
 * openai.ts → providers/.
 */

import { PromptSection, Result, success } from "typechat";
import type { ApiSettings, CompletionUsageStats } from "../openai.js";
import type { Filter, FilterError, FilterResult } from "./types.js";

/**
 * Build auth headers for OpenAI-style endpoints (chat_completions and
 * openai_responses both use this). Azure uses either an AAD bearer token
 * (identity) or the `api-key` header; direct OpenAI uses a bearer key +
 * organization header.
 */
export async function createApiHeaders(
    settings: ApiSettings,
): Promise<Result<Record<string, string>>> {
    let apiHeaders: Record<string, string> | undefined;
    if (settings.provider === "azure") {
        if (settings.tokenProvider) {
            const tokenResult = await settings.tokenProvider.getAccessToken();
            if (!tokenResult.success) {
                return tokenResult;
            }
            apiHeaders = {
                Authorization: `Bearer ${tokenResult.data}`,
            };
        } else {
            apiHeaders = { "api-key": settings.apiKey };
        }
    } else if (settings.provider === "openai") {
        apiHeaders = {
            Authorization: `Bearer ${settings.apiKey}`,
            "OpenAI-Organization": settings.organization ?? "",
        };
    }
    return success(apiHeaders ?? {});
}

/**
 * Throw if any Azure content filter tripped. Shared by the chat streaming
 * decoder and the image path in openai.ts.
 */
export function verifyFilterResults(filterResult: FilterResult) {
    const filters: string[] = [];
    if (filterResult) {
        if (filterResult.hate?.filtered) {
            filters.push("hate");
        }
        if (filterResult.self_harm?.filtered) {
            filters.push("self_harm");
        }
        if (filterResult.sexual?.filtered) {
            filters.push("sexual");
        }
        if (filterResult.violence?.filtered) {
            filters.push("violence");
        }
        if (filterResult.protected_material_code?.filtered) {
            filters.push("protected_material_code");
        }
        if (filterResult.protected_material_text?.filtered) {
            filters.push("protected_material_text");
        }

        if (filters.length > 0) {
            const msg = `A content filter has been triggered by one or more messages. The triggered filters are: ${filters.join(", ")}`;
            throw new Error(`${msg}`);
        }
    }
}

/** Re-export filter error shape for stream safety helpers. */
export type { Filter, FilterError, FilterResult };

/**
 * Non-OpenAI protocols report input/output token counts under different
 * keys; normalize to CompletionUsageStats.
 */
export function usageFromInputOutput(
    inputTokens: number | undefined,
    outputTokens: number | undefined,
): CompletionUsageStats | undefined {
    if (inputTokens === undefined && outputTokens === undefined) {
        return undefined;
    }
    const prompt = inputTokens ?? 0;
    const completion = outputTokens ?? 0;
    return {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
    };
}

/** Concatenate system prompt sections; return the rest as user/assistant turns. */
export function splitSystemMessages(messages: PromptSection[]): {
    system: string;
    turns: { role: string; content: unknown }[];
} {
    const systemParts: string[] = [];
    const turns: { role: string; content: unknown }[] = [];
    for (const m of messages) {
        if (m.role === "system") {
            if (typeof m.content === "string") {
                systemParts.push(m.content);
            }
            continue;
        }
        turns.push({ role: m.role, content: m.content });
    }
    return { system: systemParts.join("\n\n"), turns };
}
