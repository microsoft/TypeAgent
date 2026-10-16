// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { ChatModel } from "@typeagent/aiclient";
import {
    createRecipeRelevanceDefinition,
    RecipeSemanticAdapter,
    type RecipeSemanticProviderRequest,
} from "@typeagent/copilot-macros/recipeSemantic";
import type {
    TypeAgentRecipeModelFactory,
    TypeAgentRecipeModelRequest,
    TypeAgentRecipeSemanticProviderOptions,
} from "../src/recipeModelProvider.js";

const getSettings = jest.fn<(model: string) => Record<string, unknown>>();
const createChatModel = jest.fn<() => Pick<ChatModel, "complete">>();
const getClient = jest.fn<() => Promise<unknown>>();
const http =
    jest.fn<
        (
            ...args: unknown[]
        ) => Promise<
            | { success: true; data: unknown }
            | { success: false; message: string }
        >
    >();
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    openai: {
        getChatModelSettings: getSettings,
        createChatModel,
    },
    getCopilotClient: getClient,
    callJsonApi: http,
}));
const { createTypeAgentRecipeSemanticProvider } = await import(
    "../src/recipeModelProvider.js"
);

const definition = createRecipeRelevanceDefinition();
const observed = {
    model: "actually-served-model-2026",
    usage: { prompt_tokens: 23, completion_tokens: 7, total_tokens: 30 },
};

function request(): RecipeSemanticProviderRequest {
    return {
        definition: structuredClone(definition),
        input: {
            topic: "semantic recipes",
            candidates: [{ id: "one", title: "title", body: "body" }],
        },
        attempt: 0,
        signal: new AbortController().signal,
    };
}

function options(
    modelFactory?: TypeAgentRecipeModelFactory,
): TypeAgentRecipeSemanticProviderOptions {
    return {
        id: "typeagent-test",
        approval: { capabilityId: "approved-inference", policyRevision: "1" },
        modelPolicies: [
            { ...definition.modelPolicy, model: "copilot:selected" },
        ],
        ...(modelFactory ? { modelFactory } : {}),
    };
}

function fixture(response: unknown = observed, text = '{"decisions":[]}') {
    let modelRequest: TypeAgentRecipeModelRequest | undefined;
    const complete = jest.fn<ChatModel["complete"]>(async () => {
        modelRequest!.completionCallback({}, response);
        return { success: true, data: text };
    });
    const factory = jest.fn<TypeAgentRecipeModelFactory>((selected) => {
        modelRequest = selected;
        return { complete };
    });
    return {
        provider: createTypeAgentRecipeSemanticProvider(options(factory)),
        complete,
        factory,
    };
}

beforeEach(() => jest.clearAllMocks());

describe("TypeAgent recipe semantic provider", () => {
    test("translates versioned specification, schemas, evidence, and repair without tools", async () => {
        const { provider, factory, complete } = fixture();
        const call = request();
        call.attempt = 1;
        call.repair = { diagnostics: "decisions must contain every candidate" };
        const result = await provider.complete(call);
        expect(provider.evidenceKind).toBe("approved-provider");
        expect(factory).toHaveBeenCalledTimes(1);
        expect(factory.mock.calls[0][0]).toMatchObject({
            model: "copilot:selected",
            signal: call.signal,
            timeoutMs: definition.bounds.timeoutMs,
            completionSettings: { n: 1 },
        });
        const [prompt, usage, schema, log, signal] = complete.mock.calls[0];
        expect(Array.isArray(prompt)).toBe(true);
        if (!Array.isArray(prompt)) throw new Error("Expected prompt sections");
        expect(JSON.parse(prompt[1].content as string)).toEqual({
            function: { id: definition.id, revision: definition.revision },
            specification: definition.specification,
            modelPolicy: definition.modelPolicy,
            inputSchema: definition.inputSchema,
            outputSchema: definition.outputSchema,
            evidence: definition.evidence,
            input: call.input,
            attempt: 1,
            repair: call.repair,
        });
        expect(schema).toEqual({
            name: "recipe_semantic_output",
            schema: definition.outputSchema,
        });
        expect(Array.isArray(schema)).toBe(false);
        expect(usage).toBeUndefined();
        expect(log).toBeUndefined();
        expect(signal).toBe(call.signal);
        expect(result).toEqual({
            kind: "json",
            text: '{"decisions":[]}',
            resolvedModel: observed.model,
            inputTokens: 23,
            outputTokens: 7,
        });
    });

    test("forwards in-flight cancellation and suppresses late results", async () => {
        const controller = new AbortController();
        const call = { ...request(), signal: controller.signal };
        const complete = jest.fn<ChatModel["complete"]>(
            async (_prompt, _usage, _schema, _log, signal) => {
                expect(signal).toBe(controller.signal);
                controller.abort();
                return { success: true, data: "{}" };
            },
        );
        const provider = createTypeAgentRecipeSemanticProvider(
            options(() => ({ complete })),
        );
        await expect(provider.complete(call)).rejects.toMatchObject({
            name: "AbortError",
        });
        expect(complete).toHaveBeenCalledTimes(1);
    });

    test("already cancelled calls never construct a model", async () => {
        const { provider, factory } = fixture();
        const controller = new AbortController();
        controller.abort();
        await expect(
            provider.complete({ ...request(), signal: controller.signal }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(factory).not.toHaveBeenCalled();
    });

    test("missing policy and revision mismatch never infer", async () => {
        const { provider, factory } = fixture();
        const call = request();
        call.definition.modelPolicy.revision = "unapproved";
        await expect(provider.complete(call)).rejects.toThrow(
            "No explicit model",
        );
        expect(factory).not.toHaveBeenCalled();
    });

    test.each([
        {},
        { model: "selected-not-observed" },
        { ...observed, model: "" },
        { ...observed, usage: { input_tokens: 3 } },
        { ...observed, usage: { prompt_tokens: -1, completion_tokens: 2 } },
        { ...observed, usage: { prompt_tokens: 1.5, completion_tokens: 2 } },
        { ...observed, usage: { prompt_tokens: 3, completion_tokens: NaN } },
        {
            ...observed,
            usage: {
                input_tokens: 3,
                output_tokens: 2,
                cache_read_input_tokens: -1,
            },
        },
    ])("rejects missing or invalid real evidence: %j", async (metadata) => {
        const { provider } = fixture(metadata);
        await expect(provider.complete(request())).rejects.toThrow(
            "observed resolved model and input/output token usage",
        );
    });

    test("preserves genuinely reported zero usage", async () => {
        const { provider } = fixture({
            model: "served",
            usage: { input_tokens: 0, output_tokens: 0 },
        });
        await expect(provider.complete(request())).resolves.toMatchObject({
            resolvedModel: "served",
            inputTokens: 0,
            outputTokens: 0,
        });
    });

    test("includes reported exclusive cache buckets in input usage", async () => {
        const { provider } = fixture({
            model: "served",
            usage: {
                input_tokens: 3,
                cache_creation_input_tokens: 5,
                cache_read_input_tokens: 11,
                output_tokens: 2,
            },
        });
        await expect(provider.complete(request())).resolves.toMatchObject({
            inputTokens: 19,
            outputTokens: 2,
        });
    });

    test("returns untrusted completion text unchanged for adapter validation, never stringifies prose", async () => {
        const { provider } = fixture(observed, "not JSON");
        await expect(provider.complete(request())).resolves.toMatchObject({
            text: "not JSON",
        });
        const schemaDefinition = structuredClone(definition);
        schemaDefinition.evidence = { sourceIds: "none", quotations: false };
        const adapter = new RecipeSemanticAdapter(
            { definition: schemaDefinition },
            provider,
        );
        await expect(
            adapter.invokeSemantic(schemaDefinition, request().input, {
                runId: "run",
                callId: "call",
                binding: {
                    workspaceId: "workspace",
                    profileId: "profile",
                    providerId: "host",
                    accountId: "account",
                    sessionId: "session",
                    generation: "1",
                },
                signal: new AbortController().signal,
            }),
        ).resolves.toMatchObject({ status: "invalid_output" });
    });

    test("propagates model failures without fallback or retries", async () => {
        const { provider, complete } = fixture();
        complete.mockResolvedValue({
            success: false,
            message: "provider denied",
        });
        await expect(provider.complete(request())).rejects.toThrow(
            "provider denied",
        );
        expect(complete).toHaveBeenCalledTimes(1);
        const error = new Error("factory unavailable");
        const failed = createTypeAgentRecipeSemanticProvider(
            options(() => {
                throw error;
            }),
        );
        await expect(failed.complete(request())).rejects.toBe(error);
    });

    test("checks approval and snapshots the policy selection", async () => {
        const { factory } = fixture();
        const configured = options(factory);
        const provider = createTypeAgentRecipeSemanticProvider(configured);
        configured.modelPolicies[0].model = "changed";
        await provider.complete(request());
        expect(factory.mock.calls[0][0].model).toBe("copilot:selected");
        expect(() =>
            createTypeAgentRecipeSemanticProvider({
                ...options(),
                approval: { capabilityId: "", policyRevision: "1" },
            }),
        ).toThrow("approved");
        expect(() =>
            createTypeAgentRecipeSemanticProvider({
                ...options(),
                modelPolicies: [
                    ...options().modelPolicies,
                    ...options().modelPolicies,
                ],
            }),
        ).toThrow("Duplicate");
    });

    test.each(["auto", "copilot:auto", "copilot:", ""])(
        "rejects implicit or auto model selection %j",
        (model) => {
            expect(() =>
                createTypeAgentRecipeSemanticProvider({
                    ...options(),
                    modelPolicies: [{ ...definition.modelPolicy, model }],
                }),
            ).toThrow("selected model");
        },
    );

    test("cancellation during model acquisition prevents inference", async () => {
        const controller = new AbortController();
        const complete = jest.fn<ChatModel["complete"]>();
        const provider = createTypeAgentRecipeSemanticProvider(
            options(async () => {
                controller.abort();
                return { complete };
            }),
        );
        await expect(
            provider.complete({ ...request(), signal: controller.signal }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(complete).not.toHaveBeenCalled();
    });
});

describe("configured production transport (offline)", () => {
    test("uses a configured non-Copilot model with no inference retries", async () => {
        const settings = {
            provider: "openai",
            modelName: "configured",
            maxRetryAttempts: 9,
        };
        getSettings.mockReturnValue(settings);
        createChatModel.mockImplementation(() => ({
            async complete() {
                const callback = (
                    createChatModel.mock.calls[0] as unknown as [
                        unknown,
                        unknown,
                        TypeAgentRecipeModelRequest["completionCallback"],
                    ]
                )[2];
                callback({}, observed);
                return { success: true, data: "{}" };
            },
        }));
        const provider = createTypeAgentRecipeSemanticProvider(options());
        await provider.complete(request());
        expect(createChatModel).toHaveBeenCalledWith(
            {
                ...settings,
                maxRetryAttempts: 0,
                timeout: definition.bounds.timeoutMs,
                enableModelRequestLogging: false,
            },
            { n: 1 },
            expect.any(Function),
            ["recipe-semantic"],
        );
        expect(settings.maxRetryAttempts).toBe(9);
        expect(getClient).not.toHaveBeenCalled();
    });

    function copilot(wireApi = "chat_completions") {
        getSettings.mockReturnValue({
            provider: "copilot",
            modelName: "selected",
        });
        const endpoint = jest.fn(async () => ({
            baseUrl: "https://inference.invalid",
            wireApi,
            headers: { "test-header": "test-value" },
        }));
        const disconnect = jest.fn(async () => {});
        const createSession = jest.fn(async () => ({
            rpc: { provider: { getEndpoint: endpoint } },
            disconnect,
        }));
        getClient.mockResolvedValue({ createSession });
        return { createSession, endpoint, disconnect };
    }

    test.each(["chat_completions", "responses"])(
        "Copilot %s only mints an endpoint and sends one tools-disabled request",
        async (wireApi) => {
            const sdk = copilot(wireApi);
            http.mockResolvedValue({
                success: true,
                data: {
                    ...observed,
                    ...(wireApi === "responses"
                        ? {
                              output: [
                                  {
                                      type: "message",
                                      content: [
                                          { type: "output_text", text: "{}" },
                                      ],
                                  },
                              ],
                          }
                        : { choices: [{ message: { content: "{}" } }] }),
                },
            });
            const provider = createTypeAgentRecipeSemanticProvider(options());
            const call = request();
            await expect(provider.complete(call)).resolves.toMatchObject({
                text: "{}",
                resolvedModel: observed.model,
                inputTokens: 23,
                outputTokens: 7,
            });
            expect(sdk.createSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: "selected",
                    tools: [],
                    availableTools: [],
                    infiniteSessions: { enabled: false },
                }),
            );
            expect(sdk.endpoint).toHaveBeenCalledWith({ modelId: "selected" });
            expect(sdk.disconnect).toHaveBeenCalledTimes(1);
            expect(http).toHaveBeenCalledTimes(1);
            const args = http.mock.calls[0];
            expect(args[3]).toBe(0);
            expect(args[7]).toBe(call.signal);
            const body = args[2] as Record<string, unknown>;
            expect(body.model).toBe("selected");
            expect(body.tools).toBeUndefined();
            expect(body.tool_choice).toBeUndefined();
            expect(
                wireApi === "responses" ? body.text : body.response_format,
            ).toEqual(
                wireApi === "responses"
                    ? {
                          format: {
                              type: "json_schema",
                              name: "recipe_semantic_output",
                              schema: definition.outputSchema,
                          },
                      }
                    : {
                          type: "json_schema",
                          json_schema: {
                              name: "recipe_semantic_output",
                              schema: definition.outputSchema,
                          },
                      },
            );
        },
    );

    test("Copilot failure never refreshes, retries, or falls back to SDK inference", async () => {
        const sdk = copilot();
        http.mockResolvedValue({ success: false, message: "HTTP rejected" });
        const provider = createTypeAgentRecipeSemanticProvider(options());
        await expect(provider.complete(request())).rejects.toThrow(
            "HTTP rejected",
        );
        expect(http).toHaveBeenCalledTimes(1);
        expect(sdk.endpoint).toHaveBeenCalledTimes(1);
        expect(sdk.createSession).toHaveBeenCalledTimes(1);
    });

    test("Copilot endpoint failures propagate and disconnect the discovery session", async () => {
        const sdk = copilot();
        const failure = new Error("endpoint unavailable");
        sdk.endpoint.mockRejectedValue(failure);
        const provider = createTypeAgentRecipeSemanticProvider(options());
        await expect(provider.complete(request())).rejects.toBe(failure);
        expect(sdk.disconnect).toHaveBeenCalledTimes(1);
        expect(http).not.toHaveBeenCalled();
    });

    test("Copilot rejects unexpected tool-call responses", async () => {
        copilot();
        http.mockResolvedValue({
            success: true,
            data: {
                ...observed,
                choices: [{ message: { content: "{}", tool_calls: [] } }],
            },
        });
        const provider = createTypeAgentRecipeSemanticProvider(options());
        await expect(provider.complete(request())).rejects.toThrow(
            "Unexpected tool calls",
        );
        expect(http).toHaveBeenCalledTimes(1);
    });

    test("Copilot Responses accepts internal reasoning, not external work", async () => {
        copilot("responses");
        http.mockResolvedValue({
            success: true,
            data: {
                ...observed,
                output: [
                    { type: "reasoning" },
                    {
                        type: "message",
                        content: [{ type: "output_text", text: "{}" }],
                    },
                ],
            },
        });
        const provider = createTypeAgentRecipeSemanticProvider(options());
        await expect(provider.complete(request())).resolves.toMatchObject({
            text: "{}",
        });
    });
});
