// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * openai_responses wire adapter.
 *
 * OpenAI Responses API (`/responses`): same auth as chat_completions but a
 * different body (`input` / `instructions`) and response (`output` blocks /
 * `output_text`).
 */

import { Result, success } from "typechat";
import type { WireApi } from "@typeagent/config";
import type { ApiSettings, CompletionUsageStats } from "../openai.js";
import {
    createApiHeaders,
    splitSystemMessages,
    usageFromInputOutput,
} from "./shared.js";
import type {
    ModelRequest,
    ProviderAdapter,
    StreamDecoder,
    StreamPiece,
} from "./types.js";

type ResponsesOutputContent = { type: string; text?: string };
type ResponsesOutputItem = {
    type?: string;
    content?: ResponsesOutputContent[];
    name?: string;
    arguments?: string;
};
type ResponsesResult = {
    output_text?: string;
    output?: ResponsesOutputItem[];
    usage?: { input_tokens?: number; output_tokens?: number };
};

export class OpenAIResponsesAdapter implements ProviderAdapter {
    readonly wireApi: WireApi = "openai_responses";

    buildHeaders(settings: ApiSettings) {
        // Responses API uses the same OpenAI/Azure auth as chat_completions.
        return createApiHeaders(settings);
    }

    buildRequestBody(request: ModelRequest): unknown {
        const { system, turns } = splitSystemMessages(request.messages);
        const cs = request.completionSettings;
        const input = turns.map((t) => ({
            role: t.role,
            content: [
                {
                    type: t.role === "assistant" ? "output_text" : "input_text",
                    text:
                        typeof t.content === "string"
                            ? t.content
                            : JSON.stringify(t.content),
                },
            ],
        }));
        const body: Record<string, unknown> = {
            ...request.defaultParams,
            input,
        };
        if (system) {
            body.instructions = system;
        }
        if (typeof cs.temperature === "number") {
            body.temperature = cs.temperature;
        }
        const maxOut =
            (cs.max_completion_tokens as number | undefined) ??
            (cs.max_tokens as number | undefined);
        if (maxOut !== undefined) {
            body.max_output_tokens = maxOut;
        }
        if (request.stream) {
            body.stream = true;
        }
        return body;
    }

    parseResponse(data: unknown, _request: ModelRequest): Result<string> {
        const res = data as ResponsesResult;
        if (typeof res.output_text === "string") {
            return success(res.output_text);
        }
        const parts: string[] = [];
        for (const item of res.output ?? []) {
            for (const c of item.content ?? []) {
                if (c.type === "output_text" && typeof c.text === "string") {
                    parts.push(c.text);
                }
            }
        }
        return success(parts.join(""));
    }

    extractUsage(data: unknown): CompletionUsageStats | undefined {
        const usage = (data as ResponsesResult).usage;
        return usageFromInputOutput(usage?.input_tokens, usage?.output_tokens);
    }

    createStreamDecoder(): StreamDecoder {
        // Responses SSE: response.output_text.delta { delta } for text,
        // response.completed { response: { usage } } for final counts.
        return {
            push: (raw: string): StreamPiece => {
                const evt = JSON.parse(raw) as {
                    type?: string;
                    delta?: string;
                    response?: {
                        usage?: {
                            input_tokens?: number;
                            output_tokens?: number;
                        };
                    };
                };
                const piece: StreamPiece = {};
                if (
                    evt.type === "response.output_text.delta" &&
                    typeof evt.delta === "string"
                ) {
                    piece.text = evt.delta;
                }
                const usage = evt.response?.usage;
                if (usage) {
                    piece.usage = usageFromInputOutput(
                        usage.input_tokens,
                        usage.output_tokens,
                    );
                }
                return piece;
            },
            finish: () => undefined,
        };
    }
}

/** Singleton used by the dispatcher (adapters are stateless). */
export const openaiResponsesAdapter = new OpenAIResponsesAdapter();
