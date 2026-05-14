// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    configFromEnvRecord,
    discoverEndpointPoolFromConfig,
} from "../src/index.js";
import { ModelType } from "../src/openai.js";

describe("discoverEndpointPoolFromConfig: typed-Config endpoint pool", () => {
    test("named model, single region: pool of one", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://eastus",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
        });
        const pool = discoverEndpointPoolFromConfig(
            config,
            "azure",
            ModelType.Chat,
            "gpt_4_o",
        );
        expect(pool.modelKey).toBe("azure:gpt_4_o");
        expect(pool.members).toHaveLength(1);
        expect(pool.members[0].suffix).toBe("GPT_4_O_EASTUS");
        expect(pool.members[0].priority).toBe(2); // PAYG default
        expect(pool.members[0].mode).toBe("PAYG");
        expect(pool.members[0].region).toBe("eastus");
    });

    test("named model with PTU + multiple PAYG regions: tiered pool", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS_PTU: "https://eastus-ptu",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS_PTU: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDENCENTRAL: "https://sweden",
            AZURE_OPENAI_API_KEY_GPT_4_O_SWEDENCENTRAL: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_WESTUS: "https://westus",
            AZURE_OPENAI_API_KEY_GPT_4_O_WESTUS: "identity",
        });
        const pool = discoverEndpointPoolFromConfig(
            config,
            "azure",
            ModelType.Chat,
            "gpt_4_o",
        );
        expect(pool.members).toHaveLength(3);
        const ptu = pool.members.find((m) => m.mode === "PTU")!;
        expect(ptu).toBeDefined();
        expect(ptu.priority).toBe(1);
        expect(ptu.suffix).toBe("GPT_4_O_EASTUS_PTU");

        const payg = pool.members.filter((m) => m.mode === "PAYG");
        expect(payg).toHaveLength(2);
        for (const m of payg) {
            expect(m.priority).toBe(2);
        }
    });

    test("AZURE_OPENAI_POOL_<MODEL> JSON override (in extras) wins", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS_PTU: "https://eastus-ptu",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS_PTU: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDENCENTRAL: "https://sweden",
            AZURE_OPENAI_API_KEY_GPT_4_O_SWEDENCENTRAL: "identity",
            AZURE_OPENAI_POOL_GPT_4_O: JSON.stringify([
                {
                    suffix: "GPT_4_O_EASTUS_PTU",
                    priority: 3,
                    mode: "PAYG",
                },
                {
                    suffix: "GPT_4_O_SWEDENCENTRAL",
                    priority: 1,
                    tpm: 30000,
                },
            ]),
        });
        const pool = discoverEndpointPoolFromConfig(
            config,
            "azure",
            ModelType.Chat,
            "gpt_4_o",
        );
        const ptu = pool.members.find((m) => m.region === "eastus")!;
        const sweden = pool.members.find((m) => m.region === "swedencentral")!;
        expect(ptu).toBeDefined();
        expect(sweden).toBeDefined();
        // Override flipped mode PTU -> PAYG and set priority=3
        expect(ptu.priority).toBe(3);
        expect(ptu.mode).toBe("PAYG");
        expect(sweden.priority).toBe(1);
        expect(sweden.declaredTpm).toBe(30000);
    });

    test("invalid pool JSON in extras is ignored, no throw", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://eastus",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
            AZURE_OPENAI_POOL_GPT_4_O: "{not valid json",
        });
        expect(() =>
            discoverEndpointPoolFromConfig(
                config,
                "azure",
                ModelType.Chat,
                "gpt_4_o",
            ),
        ).not.toThrow();
    });

    test("default embedding: bare endpoint produces single-member pool", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_EMBEDDING: "https://embed-default",
            AZURE_OPENAI_API_KEY_EMBEDDING: "identity",
        });
        const pool = discoverEndpointPoolFromConfig(
            config,
            "azure",
            ModelType.Embedding,
        );
        expect(pool.members).toHaveLength(1);
        expect(pool.members[0].suffix).toBe("");
        expect(pool.members[0].priority).toBe(1);
    });

    test("typed-Config pools are isolated by deployment name (no prefix collision)", () => {
        // Same "swallowing" hazard as the legacy GPT_4_O / GPT_4_O_MINI test:
        // gpt_4_o pool must not accidentally include gpt_4_o_mini members.
        // The typed map literally keys deployments by name so this is
        // structurally impossible — no heuristic needed.
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://4o-eastus",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDENCENTRAL_PTU:
                "https://4o-sweden-ptu",
            AZURE_OPENAI_API_KEY_GPT_4_O_SWEDENCENTRAL_PTU: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_MINI_EASTUS: "https://4o-mini-eastus",
            AZURE_OPENAI_API_KEY_GPT_4_O_MINI_EASTUS: "identity",
        });
        const pool = discoverEndpointPoolFromConfig(
            config,
            "azure",
            ModelType.Chat,
            "gpt_4_o",
        );
        const suffixes = pool.members.map((m) => m.suffix).sort();
        expect(suffixes).toEqual([
            "GPT_4_O_EASTUS",
            "GPT_4_O_SWEDENCENTRAL_PTU",
        ]);
    });

    test("openai provider: single-member pool from config.openAI", () => {
        const config = configFromEnvRecord({
            OPENAI_API_KEY: "sk-test",
            OPENAI_ENDPOINT: "https://api.openai.com/v1/chat/completions",
        });
        const pool = discoverEndpointPoolFromConfig(
            config,
            "openai",
            ModelType.Chat,
        );
        expect(pool.modelKey).toBe("openai:");
        expect(pool.members).toHaveLength(1);
        expect(pool.members[0].settings.provider).toBe("openai");
    });

    test("ollama provider: throws", () => {
        const config = configFromEnvRecord({});
        expect(() =>
            discoverEndpointPoolFromConfig(config, "ollama", ModelType.Chat),
        ).toThrow(/not applicable to ollama/);
    });

    test("missing deployment surfaces descriptive error from azureApiSettingsFromConfig", () => {
        const config = configFromEnvRecord({});
        expect(() =>
            discoverEndpointPoolFromConfig(
                config,
                "azure",
                ModelType.Chat,
                "nonexistent",
            ),
        ).toThrow(/No Azure OpenAI endpoint configured/);
    });

    test("per-member throttler attached when maxConcurrency is set", () => {
        const config = configFromEnvRecord({
            AZURE_OPENAI_MAX_CONCURRENCY: "8",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://eastus",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
        });
        const pool = discoverEndpointPoolFromConfig(
            config,
            "azure",
            ModelType.Chat,
            "gpt_4_o",
        );
        expect(pool.members[0].settings.throttler).toBeDefined();
        expect(pool.members[0].settings.maxConcurrency).toBe(8);
    });

    test("PTU member is highest priority and pickable first", () => {
        // Sanity check that the legacy pickEndpoint runtime works against
        // the typed-built pool — proves shape compatibility without
        // separately importing pickEndpoint.
        const config = configFromEnvRecord({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS_PTU: "https://eastus-ptu",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS_PTU: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_WESTUS: "https://westus",
            AZURE_OPENAI_API_KEY_GPT_4_O_WESTUS: "identity",
        });
        const pool = discoverEndpointPoolFromConfig(
            config,
            "azure",
            ModelType.Chat,
            "gpt_4_o",
        );
        // pool.members order matches dep.pool which is sorted by priority.
        expect(pool.members[0].mode).toBe("PTU");
        expect(pool.members[0].priority).toBeLessThan(pool.members[1].priority);
    });
});
