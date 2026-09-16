// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
// Responses API: input_tokens is the full input; cache hits are a subset
// under input_tokens_details (OpenAI/Azure prompt-caching).
type ResponsesUsage = {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
};

type ResponsesResult = {
    output_text?: string;
    output?: ResponsesOutputItem[];
    usage?: ResponsesUsage;
};

export class ResponsesWireApiProvider implements ProviderAdapter {
    readonly wireApi: WireApi = "responses";

    buildHeaders(settings: ApiSettings) {
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
        if (cs.temperature !== undefined) {
            body.temperature = cs.temperature;
        }
        if (cs.max_completion_tokens !== undefined) {
            body.max_output_tokens = cs.max_completion_tokens;
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
        return usageFromInputOutput(
            usage?.input_tokens,
            usage?.output_tokens,
            usage?.input_tokens_details?.cached_tokens,
        );
    }

    createStreamDecoder(): StreamDecoder {
        return {
            push: (raw: string): StreamPiece => {
                const evt = JSON.parse(raw) as {
                    type?: string;
                    delta?: string;
                    response?: {
                        usage?: ResponsesUsage;
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
                        usage.input_tokens_details?.cached_tokens,
                    );
                }
                return piece;
            },
            finish: () => undefined,
        };
    }
}

export const responsesWireApiProvider = new ResponsesWireApiProvider();
