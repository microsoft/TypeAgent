// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadConfigSync } from "@typeagent/config";

loadConfigSync();

import { getData } from "typechat";
import { testIf } from "./testCore.js";
import { ApiSettings, createChatModel, ModelType } from "../src/openai.js";

// One live integration test per wire-api. Each is skipped unless the
// operator supplies a full endpoint URL + API key (and, for the
// non-Azure protocols, a model name) via env. These exercise the
// ProviderAdapter seam end-to-end against a real service: the endpoint
// pool still routes, then adapterFor(wireApi) encodes the request and
// decodes the response.
//
//   chat_completions  (default) : AZURE_OPENAI_ENDPOINT_* + key (existing)
//   openai_responses             : TEST_CODEX_RESPONSES_ENDPOINT / _API_KEY / _MODEL
//   anthropic_messages          : TEST_ANTHROPIC_ENDPOINT / _API_KEY / _MODEL
//
// The endpoint value is the *full* URL the adapter POSTs to (the pool
// uses settings.endpoint verbatim), e.g.
//   https://<res>.openai.azure.com/openai/deployments/<dep>/chat/completions?api-version=...
//   https://api.openai.com/v1/responses
//   https://api.anthropic.com/v1/messages

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

    // OpenAI Responses protocol. Bearer auth (provider "openai").
    testIf(
        () =>
            has(
                "TEST_CODEX_RESPONSES_ENDPOINT",
                "TEST_CODEX_RESPONSES_API_KEY",
                "TEST_CODEX_RESPONSES_MODEL",
            ),
        "openai_responses completes",
        async () => {
            const settings = {
                provider: "openai",
                modelType: ModelType.Chat,
                endpoint: env("TEST_CODEX_RESPONSES_ENDPOINT")!,
                apiKey: env("TEST_CODEX_RESPONSES_API_KEY")!,
                modelName: env("TEST_CODEX_RESPONSES_MODEL")!,
                wireApi: "openai_responses",
            } as unknown as ApiSettings;
            await expectHello(settings);
        },
        testTimeout,
    );

    // Anthropic Messages protocol. The adapter supplies its own
    // x-api-key + anthropic-version headers, so the routing provider bucket
    // is immaterial here; wireApi drives the wire protocol.
    testIf(
        () =>
            has(
                "TEST_ANTHROPIC_ENDPOINT",
                "TEST_ANTHROPIC_API_KEY",
                "TEST_ANTHROPIC_MODEL",
            ),
        "anthropic_messages completes",
        async () => {
            const settings = {
                provider: "azure",
                modelType: ModelType.Chat,
                endpoint: env("TEST_ANTHROPIC_ENDPOINT")!,
                apiKey: env("TEST_ANTHROPIC_API_KEY")!,
                modelName: env("TEST_ANTHROPIC_MODEL")!,
                wireApi: "anthropic_messages",
            } as unknown as ApiSettings;
            await expectHello(settings);
        },
        testTimeout,
    );
});
