// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection } from "typechat";
import {
    adapterFor,
    createApiHeaders,
    verifyFilterResults,
    type ModelRequest,
    type FilterResult,
} from "../src/wireApiProvider/index.js";
import type { AzureApiSettings } from "../src/azureSettings.js";
import type { OpenAIApiSettings } from "../src/openaiSettings.js";

// Minimal ModelRequest builder for adapter body/response tests.
function makeRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
    return {
        messages: [
            { role: "system", content: "You are helpful." },
            { role: "user", content: "Hello" },
        ] as PromptSection[],
        completionSettings: { temperature: 0.5, max_completion_tokens: 100 },
        defaultParams: {},
        disableResponseFormat: false,
        ...overrides,
    };
}

describe("adapterFor: dispatch + back-compat", () => {
    test("undefined (legacy config) resolves to the chat_completions adapter", () => {
        expect(adapterFor(undefined).wireApi).toBe("chat_completions");
    });

    test("undefined and explicit chat_completions resolve to the same singleton", () => {
        expect(adapterFor(undefined)).toBe(adapterFor("chat_completions"));
    });

    test("each wire-api maps to an adapter reporting that wire-api", () => {
        expect(adapterFor("chat_completions").wireApi).toBe("chat_completions");
        expect(adapterFor("responses").wireApi).toBe("responses");
        expect(adapterFor("messages").wireApi).toBe("messages");
    });

    test("adapters are stateless singletons (stable identity per wire-api)", () => {
        expect(adapterFor("responses")).toBe(adapterFor("responses"));
        expect(adapterFor("messages")).toBe(adapterFor("messages"));
    });
});

describe("ChatCompletionsWireApiProvider (default path is byte-identical)", () => {
    const adapter = adapterFor("chat_completions");

    test("buildRequestBody merges defaultParams, messages, completionSettings", () => {
        const req = makeRequest({
            defaultParams: { model: "gpt-4o" },
            completionSettings: { temperature: 0.5, n: 1 },
        });
        const body = adapter.buildRequestBody(req) as Record<string, unknown>;
        expect(body.model).toBe("gpt-4o");
        expect(body.messages).toBe(req.messages);
        expect(body.temperature).toBe(0.5);
        expect(body.n).toBe(1);
        // No streaming keys on a non-stream request.
        expect(body.stream).toBeUndefined();
        expect(body.stream_options).toBeUndefined();
    });

    test("buildRequestBody adds stream + stream_options when streaming", () => {
        const req = makeRequest({
            stream: true,
            streamOptions: { include_usage: true },
        });
        const body = adapter.buildRequestBody(req) as Record<string, unknown>;
        expect(body.stream).toBe(true);
        expect(body.stream_options).toEqual({ include_usage: true });
    });

    test("array jsonSchema becomes tools + forced tool_choice", () => {
        const req = makeRequest({
            jsonSchema: [
                {
                    type: "function",
                    function: { name: "do_it", parameters: { type: "object" } },
                },
            ],
        });
        const body = adapter.buildRequestBody(req) as Record<string, unknown>;
        expect(Array.isArray(body.tools)).toBe(true);
        expect(body.tool_choice).toBe("required");
        expect(body.parallel_tool_calls).toBe(false);
    });

    test("object jsonSchema upgrades a json_object response_format to json_schema", () => {
        const req = makeRequest({
            completionSettings: {
                response_format: { type: "json_object" },
            } as any,
            jsonSchema: { name: "Result", schema: { type: "object" } },
        });
        const body = adapter.buildRequestBody(req) as Record<string, any>;
        expect(body.response_format.type).toBe("json_schema");
        expect(body.response_format.json_schema).toEqual({
            name: "Result",
            schema: { type: "object" },
        });
    });

    test("disableResponseFormat + jsonSchema throws", () => {
        const req = makeRequest({
            disableResponseFormat: true,
            jsonSchema: { name: "Result", schema: { type: "object" } },
            modelName: "o1-mini",
        });
        expect(() => adapter.buildRequestBody(req)).toThrow(
            /Json schema not supported/,
        );
    });

    test("parseResponse returns message content for a plain completion", () => {
        const req = makeRequest();
        const data = {
            id: "x",
            choices: [{ message: { role: "assistant", content: "hi there" } }],
            usage: {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3,
            },
        };
        const r = adapter.parseResponse(data, req);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data).toBe("hi there");
    });

    test("parseResponse errors when no choices returned", () => {
        const r = adapter.parseResponse(
            { id: "x", choices: [] },
            makeRequest(),
        );
        expect(r.success).toBe(false);
    });

    test("parseResponse unwraps a single tool call for function calling", () => {
        const req = makeRequest({
            jsonSchema: [{ type: "function", function: { name: "do_it" } }],
        });
        const data = {
            id: "x",
            choices: [
                {
                    message: {
                        role: "assistant",
                        tool_calls: [
                            {
                                id: "c1",
                                type: "function",
                                function: {
                                    name: "do_it",
                                    arguments: '{"a":1}',
                                },
                            },
                        ],
                    },
                },
            ],
        };
        const r = adapter.parseResponse(data, req);
        expect(r.success).toBe(true);
        if (r.success) {
            expect(JSON.parse(r.data)).toEqual({
                name: "do_it",
                arguments: { a: 1 },
            });
        }
    });

    test("extractUsage returns the usage block verbatim", () => {
        const usage = {
            prompt_tokens: 5,
            completion_tokens: 7,
            total_tokens: 12,
        };
        expect(adapter.extractUsage({ id: "x", choices: [], usage })).toEqual(
            usage,
        );
    });

    test("extractUsage tracks nested prompt_tokens_details.cached_tokens", () => {
        expect(
            adapter.extractUsage({
                id: "x",
                choices: [],
                usage: {
                    prompt_tokens: 100,
                    completion_tokens: 20,
                    total_tokens: 120,
                    prompt_tokens_details: { cached_tokens: 40 },
                },
            }),
        ).toEqual({
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            cached_tokens: 40,
        });
    });

    test("streaming decoder assembles content deltas", () => {
        const decoder = adapter.createStreamDecoder!(makeRequest());
        const p1 = decoder.push(
            JSON.stringify({
                id: "x",
                choices: [{ delta: { content: "Hel" } }],
            }),
        );
        const p2 = decoder.push(
            JSON.stringify({
                id: "x",
                choices: [{ delta: { content: "lo" } }],
            }),
        );
        expect(p1.text).toBe("Hel");
        expect(p2.text).toBe("lo");
        expect(decoder.finish()).toBeUndefined();
    });

    test("streaming decoder surfaces usage events", () => {
        const decoder = adapter.createStreamDecoder!(makeRequest());
        const piece = decoder.push(
            JSON.stringify({
                id: "x",
                choices: [],
                usage: {
                    prompt_tokens: 1,
                    completion_tokens: 2,
                    total_tokens: 3,
                },
            }),
        );
        expect(piece.usage).toEqual({
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3,
        });
    });
});

describe("MessagesWireApiProvider", () => {
    const adapter = adapterFor("messages");

    test("buildRequestBody splits system prompt, requires max_tokens", () => {
        const req = makeRequest({
            modelName: "claude-3-5-sonnet",
            completionSettings: {
                temperature: 0.3,
                max_completion_tokens: 256,
            },
        });
        const body = adapter.buildRequestBody(req) as Record<string, any>;
        expect(body.model).toBe("claude-3-5-sonnet");
        expect(body.system).toBe("You are helpful.");
        expect(body.max_tokens).toBe(256);
        expect(body.temperature).toBe(0.3);
        // System turn is removed from the messages array.
        expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
    });

    test("buildRequestBody throws when max_completion_tokens is missing", () => {
        const req = makeRequest({ completionSettings: {} });
        expect(() => adapter.buildRequestBody(req)).toThrow(
            /max_completion_tokens/,
        );
    });

    test("array jsonSchema maps to Anthropic tool use", () => {
        const req = makeRequest({
            jsonSchema: [
                {
                    type: "function",
                    function: {
                        name: "do_it",
                        description: "does it",
                        parameters: { type: "object" },
                    },
                },
            ],
        });
        const body = adapter.buildRequestBody(req) as Record<string, any>;
        expect(body.tools[0].name).toBe("do_it");
        expect(body.tools[0].input_schema).toEqual({ type: "object" });
        expect(body.tool_choice).toEqual({ type: "any" });
    });

    test("parseResponse concatenates text blocks", () => {
        const data = {
            content: [
                { type: "text", text: "Hello " },
                { type: "text", text: "world" },
            ],
        };
        const r = adapter.parseResponse(data, makeRequest());
        expect(r.success).toBe(true);
        if (r.success) expect(r.data).toBe("Hello world");
    });

    test("parseResponse unwraps a tool_use block for function calling", () => {
        const req = makeRequest({
            jsonSchema: [{ type: "function", function: { name: "do_it" } }],
        });
        const data = {
            content: [
                { type: "tool_use", id: "t1", name: "do_it", input: { a: 1 } },
            ],
        };
        const r = adapter.parseResponse(data, req);
        expect(r.success).toBe(true);
        if (r.success) {
            expect(JSON.parse(r.data)).toEqual({
                name: "do_it",
                arguments: { a: 1 },
            });
        }
    });

    test("extractUsage normalizes input/output tokens", () => {
        const usage = adapter.extractUsage({
            content: [],
            usage: { input_tokens: 10, output_tokens: 4 },
        });
        expect(usage).toEqual({
            prompt_tokens: 10,
            completion_tokens: 4,
            total_tokens: 14,
        });
    });

    test("streaming decoder emits text_delta content", () => {
        const decoder = adapter.createStreamDecoder!(makeRequest());
        const piece = decoder.push(
            JSON.stringify({
                type: "content_block_delta",
                delta: { type: "text_delta", text: "hi" },
            }),
        );
        expect(piece.text).toBe("hi");
    });
});

describe("ResponsesWireApiProvider", () => {
    const adapter = adapterFor("responses");

    test("buildRequestBody uses input array + instructions + max_output_tokens", () => {
        const req = makeRequest({
            defaultParams: { model: "gpt-5-codex" },
            completionSettings: {
                temperature: 0.2,
                max_completion_tokens: 512,
            },
        });
        const body = adapter.buildRequestBody(req) as Record<string, any>;
        expect(body.model).toBe("gpt-5-codex");
        expect(body.instructions).toBe("You are helpful.");
        expect(body.max_output_tokens).toBe(512);
        expect(body.temperature).toBe(0.2);
        expect(Array.isArray(body.input)).toBe(true);
        expect(body.input[0].role).toBe("user");
        expect(body.input[0].content[0].type).toBe("input_text");
        expect(body.input[0].content[0].text).toBe("Hello");
    });

    test("parseResponse prefers a flat output_text", () => {
        const r = adapter.parseResponse({ output_text: "done" }, makeRequest());
        expect(r.success).toBe(true);
        if (r.success) expect(r.data).toBe("done");
    });

    test("parseResponse falls back to output blocks", () => {
        const data = {
            output: [
                {
                    type: "message",
                    content: [
                        { type: "output_text", text: "a" },
                        { type: "output_text", text: "b" },
                    ],
                },
            ],
        };
        const r = adapter.parseResponse(data, makeRequest());
        expect(r.success).toBe(true);
        if (r.success) expect(r.data).toBe("ab");
    });

    test("extractUsage normalizes input/output tokens", () => {
        const usage = adapter.extractUsage({
            usage: { input_tokens: 3, output_tokens: 9 },
        });
        expect(usage).toEqual({
            prompt_tokens: 3,
            completion_tokens: 9,
            total_tokens: 12,
        });
    });

    test("streaming decoder emits response.output_text.delta content", () => {
        const decoder = adapter.createStreamDecoder!(makeRequest());
        const piece = decoder.push(
            JSON.stringify({
                type: "response.output_text.delta",
                delta: "chunk",
            }),
        );
        expect(piece.text).toBe("chunk");
    });
});

describe("createApiHeaders (shared auth helper)", () => {
    test("Azure with explicit key uses the api-key header", async () => {
        const settings = {
            provider: "azure",
            apiKey: "sk-123",
        } as unknown as AzureApiSettings;
        const r = await createApiHeaders(settings);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data).toEqual({ "api-key": "sk-123" });
    });

    test("direct OpenAI uses a bearer token + organization header", async () => {
        const settings = {
            provider: "openai",
            apiKey: "sk-oai",
            organization: "org-1",
        } as unknown as OpenAIApiSettings;
        const r = await createApiHeaders(settings);
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.Authorization).toBe("Bearer sk-oai");
            expect(r.data["OpenAI-Organization"]).toBe("org-1");
        }
    });
});

describe("verifyFilterResults (shared content-safety helper)", () => {
    test("passes when no filter tripped", () => {
        const clean: FilterResult = {
            hate: { filtered: false, severity: "safe" },
        };
        expect(() => verifyFilterResults(clean)).not.toThrow();
    });

    test("throws naming the tripped filters", () => {
        const tripped: FilterResult = {
            hate: { filtered: true, severity: "high" },
            violence: { filtered: true, severity: "high" },
        };
        expect(() => verifyFilterResults(tripped)).toThrow(/hate, violence/);
    });
});
