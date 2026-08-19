// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createCopilotTransportModel,
    CopilotEndpoint,
    CopilotEndpointProvider,
    CopilotEndpointUnavailableError,
    selectCopilotModel,
} from "../src/copilotModels.js";
import type { ModelInfo } from "@github/copilot-sdk";
import { CopilotApiSettings } from "../src/copilotSettings.js";
import { ModelType } from "../src/openai.js";
import { PromptSection } from "typechat";

function makeSettings(): CopilotApiSettings {
    return {
        provider: "copilot",
        modelType: ModelType.Chat,
        endpoint: "copilot-cli",
        modelName: "claude-haiku-4.5",
        disableInfiniteSessions: true,
        fallbackModels: ["gpt-5-mini", "gpt-5.4-mini"],
        maxRetryAttempts: 0,
        retryPauseMs: 1,
        timeout: 5_000,
    };
}

function makeEndpoint(overrides?: Partial<CopilotEndpoint>): CopilotEndpoint {
    return {
        url: "https://api.example/chat/completions",
        model: "claude-haiku-4.5",
        headers: {
            Authorization: "******",
            "Copilot-Integration-Id": "copilot-developer-cli",
        },
        ...overrides,
    };
}

function makeModel(
    id: string,
    options?: {
        reasoning?: boolean;
        policy?: "enabled" | "disabled" | "unconfigured";
    },
): ModelInfo {
    return {
        id,
        name: id,
        capabilities: {
            supports: {
                vision: false,
                reasoningEffort: options?.reasoning ?? false,
            },
            limits: { max_context_window_tokens: 128_000 },
        },
        ...(options?.policy !== undefined
            ? { policy: { state: options.policy, terms: "" } }
            : {}),
    };
}

// Records force flags and hands out endpoints from a queue (last one repeats).
function makeProvider(endpoints: Array<CopilotEndpoint | Error>): {
    provider: CopilotEndpointProvider;
    forceCalls: boolean[];
} {
    const forceCalls: boolean[] = [];
    let index = 0;
    return {
        forceCalls,
        provider: {
            async getEndpoint(force = false): Promise<CopilotEndpoint> {
                forceCalls.push(force);
                const value = endpoints[Math.min(index, endpoints.length - 1)];
                if (force) index++;
                if (value instanceof Error) throw value;
                return value;
            },
        },
    };
}

function jsonResponse(status: number, body: any): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

// Build an SSE Response body from a list of `data:` payloads (objects are
// JSON-encoded; strings are sent verbatim, e.g. "[DONE]").
function sseResponse(events: Array<any>): Response {
    const body = events
        .map((e) => {
            const data = typeof e === "string" ? e : JSON.stringify(e);
            return `data: ${data}\n\n`;
        })
        .join("");
    return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
    });
}

function deltaChunk(content: string) {
    return { choices: [{ delta: { content } }] };
}

function usageChunk(usage: any) {
    return { choices: [{ delta: {} }], usage };
}

async function drain(
    it: AsyncIterableIterator<string>,
): Promise<{ chunks: string[]; text: string }> {
    const chunks: string[] = [];
    for await (const c of it) chunks.push(c);
    return { chunks, text: chunks.join("") };
}

const IMAGE_PROMPT: PromptSection[] = [
    {
        role: "user",
        content: [
            {
                type: "image_url",
                image_url: { url: "data:image/png;base64,AAAA" },
            } as any,
        ],
    },
];

const CAPI_OK = {
    choices: [{ message: { content: '{"action":"getTime"}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe("selectCopilotModel", () => {
    test("uses the requested model when it is available", () => {
        const selected = selectCopilotModel(
            "claude-haiku-4.5",
            ["gpt-5-mini"],
            [makeModel("gpt-5-mini"), makeModel("claude-haiku-4.5")],
        );
        expect(selected?.id).toBe("claude-haiku-4.5");
    });

    test("uses the first configured concrete fallback", () => {
        const selected = selectCopilotModel(
            "claude-haiku-4.5",
            ["auto", "gpt-5-mini", "gpt-5.4-mini"],
            [
                makeModel("auto"),
                makeModel("gpt-5-mini"),
                makeModel("gpt-5.4-mini"),
            ],
        );
        expect(selected?.id).toBe("gpt-5-mini");
    });

    test("skips disabled fallback models", () => {
        const selected = selectCopilotModel(
            "claude-haiku-4.5",
            ["gpt-5-mini", "gpt-5.4-mini"],
            [
                makeModel("gpt-5-mini", { policy: "disabled" }),
                makeModel("gpt-5.4-mini"),
            ],
        );
        expect(selected?.id).toBe("gpt-5.4-mini");
    });

    test("allows fallback models without an explicit policy decision", () => {
        const selected = selectCopilotModel(
            "claude-haiku-4.5",
            ["gpt-5-mini", "gpt-5.4-mini"],
            [
                makeModel("gpt-5-mini", { policy: "unconfigured" }),
                makeModel("gpt-5.4-mini"),
            ],
        );
        expect(selected?.id).toBe("gpt-5-mini");
    });

    test("uses the newest available model in the requested family", () => {
        const selected = selectCopilotModel(
            "claude-sonnet-5",
            [],
            [
                makeModel("claude-sonnet-4.6"),
                makeModel("claude-sonnet-6"),
                makeModel("claude-sonnet-5.2"),
            ],
        );
        expect(selected?.id).toBe("claude-sonnet-6");
    });

    test("uses a deterministic concrete model as the final fallback", () => {
        const selected = selectCopilotModel(
            "missing-model",
            [],
            [makeModel("z-model"), makeModel("auto"), makeModel("a-model")],
        );
        expect(selected?.id).toBe("a-model");
    });

    test("returns undefined when no concrete model is enabled", () => {
        const selected = selectCopilotModel(
            "claude-haiku-4.5",
            ["gpt-5-mini"],
            [
                makeModel("auto"),
                makeModel("gpt-5-mini", { policy: "disabled" }),
            ],
        );
        expect(selected).toBeUndefined();
    });
});

describe("createCopilotTransportModel", () => {
    const origFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = origFetch;
    });

    test("issues a direct call and returns the model content", async () => {
        const fetchArgs: Array<{ url: string; init: RequestInit }> = [];
        (globalThis as any).fetch = async (url: string, init: RequestInit) => {
            fetchArgs.push({ url, init });
            return jsonResponse(200, CAPI_OK);
        };

        const { provider } = makeProvider([makeEndpoint()]);
        const model = createCopilotTransportModel(
            makeSettings(),
            {},
            undefined,
            undefined,
            provider,
        );

        const result = await model.complete("what time is it");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toBe('{"action":"getTime"}');
        }
        expect(fetchArgs).toHaveLength(1);
        // Direct call targets the endpoint URL with its credential header, and
        // the body carries the resolved model plus the default temperature.
        expect(fetchArgs[0].url).toBe("https://api.example/chat/completions");
        const headers = fetchArgs[0].init.headers as Record<string, string>;
        expect(headers.Authorization).toBe("******");
        const body = JSON.parse(fetchArgs[0].init.body as string);
        expect(body.model).toBe("claude-haiku-4.5");
        expect(body.temperature).toBe(0);
        expect(body.messages).toEqual([
            { role: "user", content: "what time is it" },
        ]);
    });

    test("reports token usage from the response", async () => {
        (globalThis as any).fetch = async () => jsonResponse(200, CAPI_OK);
        const { provider } = makeProvider([makeEndpoint()]);
        const usage: any[] = [];
        const model = createCopilotTransportModel(
            makeSettings(),
            {},
            undefined,
            undefined,
            provider,
        );
        await model.complete("hi", (u) => usage.push(u));
        expect(usage).toHaveLength(1);
        expect(usage[0]).toEqual(CAPI_OK.usage);
    });

    test("refreshes the endpoint once on a non-2xx then succeeds", async () => {
        let call = 0;
        (globalThis as any).fetch = async () => {
            call++;
            return call === 1
                ? jsonResponse(401, { error: "expired" })
                : jsonResponse(200, CAPI_OK);
        };
        const { provider, forceCalls } = makeProvider([
            makeEndpoint(),
            makeEndpoint({ url: "https://api.example/v2/chat/completions" }),
        ]);
        const model = createCopilotTransportModel(
            makeSettings(),
            {},
            undefined,
            undefined,
            provider,
        );

        const result = await model.complete("hi");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toBe('{"action":"getTime"}');
        }
        // One forced refresh happened between the two attempts.
        expect(forceCalls.filter((f) => f === true)).toHaveLength(1);
        expect(call).toBe(2);
    });

    test("returns an error when the refreshed call still fails", async () => {
        (globalThis as any).fetch = async () =>
            jsonResponse(401, { error: "expired" });
        const { provider, forceCalls } = makeProvider([makeEndpoint()]);
        const model = createCopilotTransportModel(
            makeSettings(),
            {},
            undefined,
            undefined,
            provider,
        );

        const result = await model.complete("hi");
        expect(result.success).toBe(false);
        // A single reactive refresh was attempted before giving up.
        expect(forceCalls.filter((f) => f === true)).toHaveLength(1);
    });

    test("returns an error when the endpoint is unavailable", async () => {
        let fetchCalls = 0;
        (globalThis as any).fetch = async () => {
            fetchCalls++;
            return jsonResponse(200, CAPI_OK);
        };
        const { provider } = makeProvider([
            new CopilotEndpointUnavailableError("no concrete model"),
        ]);
        const model = createCopilotTransportModel(
            makeSettings(),
            {},
            undefined,
            undefined,
            provider,
        );

        const result = await model.complete("hi");
        expect(result.success).toBe(false);
        // No HTTP call is made when the endpoint can't be minted.
        expect(fetchCalls).toBe(0);
    });

    test("sends image content through as vision input", async () => {
        const fetchArgs: Array<{ url: string; init: RequestInit }> = [];
        (globalThis as any).fetch = async (url: string, init: RequestInit) => {
            fetchArgs.push({ url, init });
            return jsonResponse(200, CAPI_OK);
        };
        const { provider } = makeProvider([makeEndpoint()]);
        const model = createCopilotTransportModel(
            makeSettings(),
            {},
            undefined,
            undefined,
            provider,
        );

        const result = await model.complete(IMAGE_PROMPT);
        expect(result.success).toBe(true);
        expect(fetchArgs).toHaveLength(1);
        const body = JSON.parse(fetchArgs[0].init.body as string);
        expect(body.messages).toEqual(IMAGE_PROMPT);
    });

    test("streams direct deltas and reports final usage", async () => {
        const fetchArgs: Array<{ url: string; init: RequestInit }> = [];
        (globalThis as any).fetch = async (url: string, init: RequestInit) => {
            fetchArgs.push({ url, init });
            return sseResponse([
                deltaChunk('{"action":'),
                deltaChunk('"getTime"}'),
                usageChunk({
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15,
                }),
                "[DONE]",
            ]);
        };
        const { provider } = makeProvider([makeEndpoint()]);
        const usage: any[] = [];
        const model = createCopilotTransportModel(
            makeSettings(),
            {},
            undefined,
            undefined,
            provider,
        );

        const result = await model.completeStream!("what time is it", (u) =>
            usage.push(u),
        );
        expect(result.success).toBe(true);
        if (!result.success) return;
        const { chunks, text } = await drain(result.data);
        expect(chunks).toEqual(['{"action":', '"getTime"}']);
        expect(text).toBe('{"action":"getTime"}');
        expect(usage).toEqual([
            { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        ]);
        // Streaming request carries the streaming flags.
        const body = JSON.parse(fetchArgs[0].init.body as string);
        expect(body.stream).toBe(true);
        expect(body.stream_options).toEqual({ include_usage: true });
    });

    test("refreshes the endpoint once when the stream fails to connect", async () => {
        let call = 0;
        (globalThis as any).fetch = async () => {
            call++;
            return call === 1
                ? jsonResponse(401, { error: "expired" })
                : sseResponse([deltaChunk("ok"), "[DONE]"]);
        };
        const { provider, forceCalls } = makeProvider([
            makeEndpoint(),
            makeEndpoint(),
        ]);
        const model = createCopilotTransportModel(
            makeSettings(),
            {},
            undefined,
            undefined,
            provider,
        );

        const result = await model.completeStream!("hi");
        expect(result.success).toBe(true);
        if (!result.success) return;
        const { text } = await drain(result.data);
        expect(text).toBe("ok");
        expect(forceCalls.filter((f) => f === true)).toHaveLength(1);
        expect(call).toBe(2);
    });

    test("returns an error when the stream connection stays broken", async () => {
        (globalThis as any).fetch = async () =>
            jsonResponse(401, { error: "expired" });
        const { provider } = makeProvider([makeEndpoint()]);
        const model = createCopilotTransportModel(
            makeSettings(),
            {},
            undefined,
            undefined,
            provider,
        );

        const result = await model.completeStream!("hi");
        expect(result.success).toBe(false);
    });

    test("disables include_usage when streaming image content", async () => {
        const fetchArgs: Array<{ url: string; init: RequestInit }> = [];
        (globalThis as any).fetch = async (url: string, init: RequestInit) => {
            fetchArgs.push({ url, init });
            return sseResponse([deltaChunk("x"), "[DONE]"]);
        };
        const { provider } = makeProvider([makeEndpoint()]);
        const model = createCopilotTransportModel(
            makeSettings(),
            {},
            undefined,
            undefined,
            provider,
        );

        const result = await model.completeStream!(IMAGE_PROMPT);
        expect(result.success).toBe(true);
        if (!result.success) return;
        await drain(result.data);
        const body = JSON.parse(fetchArgs[0].init.body as string);
        expect(body.messages).toEqual(IMAGE_PROMPT);
        expect(body.stream).toBe(true);
        expect(body.stream_options).toEqual({ include_usage: false });
    });
});
