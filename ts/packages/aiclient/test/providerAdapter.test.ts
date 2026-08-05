// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadConfigSync } from "@typeagent/config";

loadConfigSync();

import { getData } from "typechat";
import { testIf } from "./testCore.js";
import { ApiSettings, createChatModel, ModelType } from "../src/inferenceClient.js";

// One live integration test per wire-api. Each is skipped unless the
// operator supplies a full endpoint URL + API key (and, for the
// non-Azure protocols, a model name) via env. These exercise the
// ProviderAdapter seam end-to-end against a real service: the endpoint
// pool still routes, then adapterFor(wireApi) encodes the request and
// decodes the response.
//
//   chat_completions (default) : AZURE_OPENAI_ENDPOINT_* + key (existing)
//   responses                  : TEST_RESPONSES_ENDPOINT / _API_KEY / _MODEL
//   messages                   : TEST_MESSAGES_ENDPOINT / _API_KEY / _MODEL
//
// The endpoint value is the *full* URL the provider POSTs to (the pool
// uses settings.endpoint verbatim), e.g.
//   .../chat/completions?api-version=...
//   .../v1/responses
//   .../v1/messages

const testTimeout = 60 * 1000;

function env(name: string): string | undefined {
    const v = process.env[name];
    return v !== undefined && v.length > 0 ? v : undefined;
}

function has(...names: string[]): boolean {
    return names.every((n) => env(n) !== undefined);
}

async function expectHello(settings: ApiSettings) {
    const model = createChatModel(settings);
    const result = await model.complete(
        "Reply with a short greeting, one word.",
    );
    const text = getData(result);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
}

describe("providerAdapter (live, one per wire-api)", () => {
    // Default chat_completions path against Azure OpenAI. Uses the standard
    // env-driven settings; wireApi omitted ⇒ chat_completions adapter.
    testIf(
        () =>
            has(
                "AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS",
                "AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS",
            ),
        "chat_completions completes",
        async () => {
            const settings: ApiSettings = {
                provider: "azure",
                modelType: ModelType.Chat,
                endpoint: env("AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS")!,
                apiKey: env("AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS")!,
                // wireApi omitted → default chat_completions.
            };
            await expectHello(settings);
        },
        testTimeout,
    );

    // responses wireApi. Bearer auth (provider "openai").
    testIf(
        () =>
            has(
                "TEST_RESPONSES_ENDPOINT",
                "TEST_RESPONSES_API_KEY",
                "TEST_RESPONSES_MODEL",
            ),
        "responses completes",
        async () => {
            const settings = {
                provider: "openai",
                modelType: ModelType.Chat,
                endpoint: env("TEST_RESPONSES_ENDPOINT")!,
                apiKey: env("TEST_RESPONSES_API_KEY")!,
                modelName: env("TEST_RESPONSES_MODEL")!,
                wireApi: "responses",
            } as unknown as ApiSettings;
            await expectHello(settings);
        },
        testTimeout,
    );

    // messages wireApi. Auth via createApiHeaders (same as other providers).
    testIf(
        () =>
            has(
                "TEST_MESSAGES_ENDPOINT",
                "TEST_MESSAGES_API_KEY",
                "TEST_MESSAGES_MODEL",
            ),
        "messages completes",
        async () => {
            const settings = {
                provider: "azure",
                modelType: ModelType.Chat,
                endpoint: env("TEST_MESSAGES_ENDPOINT")!,
                apiKey: env("TEST_MESSAGES_API_KEY")!,
                modelName: env("TEST_MESSAGES_MODEL")!,
                wireApi: "messages",
            } as unknown as ApiSettings;
            await expectHello(settings);
        },
        testTimeout,
    );
});
