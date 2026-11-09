// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getChatModelNames,
    setRuntimeConfig,
    configFromEnvRecord,
} from "../src/index.js";
import { _resetRuntimeConfigForTests } from "../src/runtimeConfig.js";
import { buildConfig, flatten } from "@typeagent/config";
import { createChatModel, getChatModelPool } from "../src/openai.js";

describe("getChatModelNames: typed-Config-driven enumeration", () => {
    test("Terra is selectable and sends its exact model to both Responses endpoints", async () => {
        const urls = [
            "https://example-sweden.services.ai.azure.com/openai/v1/responses",
            "https://example-eastus.services.ai.azure.com/openai/v1/responses",
        ];
        setRuntimeConfig(
            buildConfig(
                flatten({
                    azureOpenAI: {
                        defaultAuth: "test-key",
                        deployments: {
                            gpt_6_1_terra: {
                                endpoints: urls.map((endpoint, index) => ({
                                    endpoint,
                                    capacity: index === 0 ? 850 : 150,
                                    model: "gpt-6.1-terra",
                                    wireApi: "responses",
                                })),
                            },
                        },
                    },
                }),
            ),
        );
        expect(await getChatModelNames()).toContain("GPT_6_1_TERRA");
        const pool = getChatModelPool("GPT_6_1_TERRA");
        expect(pool.members).toHaveLength(2);
        const originalFetch = globalThis.fetch;
        const requests: Array<{ url: string; body: unknown }> = [];
        globalThis.fetch = async (url, init) => {
            requests.push({
                url: String(url),
                body: JSON.parse(String(init?.body)),
            });
            return new Response(JSON.stringify({ output_text: "OK" }));
        };
        try {
            for (const member of pool.members) {
                expect(member.settings.wireApi).toBe("responses");
                const result = await createChatModel(
                    member.settings,
                    {},
                ).complete("Reply OK");
                expect(result).toMatchObject({ success: true, data: "OK" });
            }
            expect(requests.map((request) => request.url)).toEqual(urls);
            for (const request of requests) {
                expect(request.body).toMatchObject({
                    model: "gpt-6.1-terra",
                    input: [
                        {
                            role: "user",
                            content: [{ type: "input_text", text: "Reply OK" }],
                        },
                    ],
                });
            }
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    afterEach(() => {
        _resetRuntimeConfigForTests();
    });

    test("enumerates Azure deployment names from typed Config (uppercased)", async () => {
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://4o",
                AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
                AZURE_OPENAI_ENDPOINT_GPT_4_O_MINI_WESTUS: "https://4o-mini",
                AZURE_OPENAI_API_KEY_GPT_4_O_MINI_WESTUS: "identity",
                AZURE_OPENAI_ENDPOINT_O3_SWEDENCENTRAL_PTU: "https://o3",
                AZURE_OPENAI_API_KEY_O3_SWEDENCENTRAL_PTU: "identity",
            }),
        );
        const names = await getChatModelNames();
        // Filter ollama additions out — those depend on a live HTTP probe.
        const azure = names.filter((n) => !n.startsWith("ollama:"));
        expect(azure.sort()).toEqual(["GPT_4_O", "GPT_4_O_MINI", "O3"].sort());
    });

    test("OpenAI named variants from extras surface as openai:<NAME>", async () => {
        setRuntimeConfig(
            configFromEnvRecord({
                OPENAI_API_KEY_LOCAL: "sk-x",
                OPENAI_ENDPOINT_LOCAL: "http://localhost",
                AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://4o",
                AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
            }),
        );
        const names = await getChatModelNames();
        expect(names).toContain("openai:LOCAL");
        expect(names).toContain("GPT_4_O");
    });

    test("regional and PTU variants of one deployment collapse to one name", async () => {
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://e",
                AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
                AZURE_OPENAI_ENDPOINT_GPT_4_O_WESTUS: "https://w",
                AZURE_OPENAI_API_KEY_GPT_4_O_WESTUS: "identity",
                AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDENCENTRAL_PTU: "https://p",
                AZURE_OPENAI_API_KEY_GPT_4_O_SWEDENCENTRAL_PTU: "identity",
            }),
        );
        const names = await getChatModelNames();
        const azure = names.filter((n) => !n.startsWith("ollama:"));
        expect(azure).toEqual(["GPT_4_O"]);
    });
});
