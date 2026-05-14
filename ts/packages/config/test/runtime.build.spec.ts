// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    authModeFromString,
    buildConfig,
    IDENTITY,
    parseSuffix,
    type FlatEnv,
} from "../src/index.js";

describe("parseSuffix", () => {
    test("strips trailing _PTU mode marker", () => {
        const r = parseSuffix("GPT_4_O_EASTUS_PTU");
        expect(r.deployment).toBe("gpt_4_o");
        expect(r.region).toBe("eastus");
        expect(r.mode).toBe("PTU");
    });

    test("longest-match region wins (canadacentral, not central)", () => {
        const r = parseSuffix("GPT_5_2_CANADACENTRAL");
        expect(r.deployment).toBe("gpt_5_2");
        expect(r.region).toBe("canadacentral");
        expect(r.mode).toBe("PAYG");
    });

    test("multi-word deployment + region", () => {
        const r = parseSuffix("EMBEDDING_3_LARGE_SWEDENCENTRAL");
        expect(r.deployment).toBe("embedding_3_large");
        expect(r.region).toBe("swedencentral");
    });

    test("no recognizable region → undefined region", () => {
        const r = parseSuffix("GPT_5");
        expect(r.deployment).toBe("gpt_5");
        expect(r.region).toBeUndefined();
    });
});

describe("authModeFromString", () => {
    test("'identity' (any case) → identity mode", () => {
        expect(authModeFromString("identity")).toEqual(IDENTITY);
        expect(authModeFromString("Identity")).toEqual(IDENTITY);
    });
    test("undefined / empty → identity mode", () => {
        expect(authModeFromString(undefined)).toEqual(IDENTITY);
        expect(authModeFromString("")).toEqual(IDENTITY);
    });
    test("any other string → key mode", () => {
        expect(authModeFromString("sk-abc")).toEqual({
            kind: "key",
            value: "sk-abc",
        });
    });
});

describe("buildConfig: Azure OpenAI defaults", () => {
    test("default tuning knobs come from constants when env is empty", () => {
        const config = buildConfig({});
        expect(config.azureOpenAI.maxConcurrency).toBe(4);
        expect(config.azureOpenAI.maxTimeoutMs).toBe(60_000);
        expect(config.azureOpenAI.maxRetryAttempts).toBe(3);
        expect(config.azureOpenAI.responseFormat).toBe(false);
        expect(config.azureOpenAI.defaultAuth).toEqual(IDENTITY);
        expect(config.azureOpenAI.deployments.size).toBe(0);
    });

    test("inherits identity default when AZURE_OPENAI_API_KEY=identity", () => {
        const flat: FlatEnv = {
            AZURE_OPENAI_API_KEY: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://eastus",
        };
        const config = buildConfig(flat);
        const dep = config.azureOpenAI.deployments.get("gpt_4_o")!;
        expect(dep).toBeDefined();
        const ep = dep.endpoints.find((e) => e.region === "eastus")!;
        expect(ep.endpoint).toBe("https://eastus");
        expect(ep.auth).toEqual(IDENTITY);
        expect(ep.region).toBe("eastus");
        expect(ep.mode).toBe("PAYG");
    });

    test("explicit per-endpoint key overrides default auth", () => {
        const flat: FlatEnv = {
            AZURE_OPENAI_API_KEY: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://eastus",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "sk-explicit",
        };
        const config = buildConfig(flat);
        const ep = config.azureOpenAI.deployments
            .get("gpt_4_o")!
            .endpoints.find((e) => e.region === "eastus")!;
        expect(ep.auth).toEqual({ kind: "key", value: "sk-explicit" });
    });

    test("PTU suffix yields PTU mode and priority 1", () => {
        const flat: FlatEnv = {
            AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDENCENTRAL_PTU:
                "https://sweden-ptu",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://eastus",
        };
        const config = buildConfig(flat);
        const dep = config.azureOpenAI.deployments.get("gpt_4_o")!;
        expect(dep.endpoints.length).toBe(2);
        // sorted by priority: PTU (1) before PAYG (2)
        expect(dep.endpoints[0].mode).toBe("PTU");
        expect(dep.endpoints[0].region).toBe("swedencentral");
        expect(dep.endpoints[0].priority).toBe(1);
        expect(dep.endpoints[1].mode).toBe("PAYG");
        expect(dep.endpoints[1].priority).toBe(2);
    });

    test("multiple deployments with multiple regions are grouped correctly", () => {
        const flat: FlatEnv = {
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://4o-east",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_WESTUS: "https://4o-west",
            AZURE_OPENAI_ENDPOINT_EMBEDDING_3_LARGE_EASTUS: "https://emb-east",
            AZURE_OPENAI_ENDPOINT_EMBEDDING_3_LARGE_SWEDENCENTRAL:
                "https://emb-sweden",
        };
        const config = buildConfig(flat);
        expect([...config.azureOpenAI.deployments.keys()].sort()).toEqual([
            "embedding_3_large",
            "gpt_4_o",
        ]);
        expect(
            config.azureOpenAI.deployments.get("embedding_3_large")!.endpoints
                .length,
        ).toBe(2);
    });

    test("bare AZURE_OPENAI_ENDPOINT_EMBEDDING goes to defaultEmbedding", () => {
        const flat: FlatEnv = {
            AZURE_OPENAI_ENDPOINT_EMBEDDING: "https://ada-bare",
            AZURE_OPENAI_API_KEY_EMBEDDING: "identity",
            AZURE_OPENAI_ENDPOINT_EMBEDDING_EASTUS: "https://ada-east",
        };
        const config = buildConfig(flat);
        expect(config.azureOpenAI.defaultEmbedding?.endpoint).toBe(
            "https://ada-bare",
        );
        // Suffixed variant still becomes a deployment
        expect(
            config.azureOpenAI.deployments
                .get("embedding")
                ?.endpoints.find((e) => e.region === "eastus")?.endpoint,
        ).toBe("https://ada-east");
    });

    test("unrecognized AZURE_OPENAI_*_NOREGION endpoints land in extra", () => {
        const flat: FlatEnv = {
            // No recognizable region in the suffix
            AZURE_OPENAI_ENDPOINT_GPT_5: "https://gpt5-bare",
        };
        const config = buildConfig(flat);
        expect(config.azureOpenAI.deployments.size).toBe(0);
        expect(config.extra.get("AZURE_OPENAI_ENDPOINT_GPT_5")).toBe(
            "https://gpt5-bare",
        );
    });
});

describe("buildConfig: other sections", () => {
    test("speech section requires region", () => {
        const flat: FlatEnv = {
            SPEECH_SDK_KEY: "identity",
            SPEECH_SDK_REGION: "westus",
            SPEECH_SDK_ENDPOINT: "https://speech",
        };
        const config = buildConfig(flat);
        expect(config.speech?.region).toBe("westus");
        expect(config.speech?.auth).toEqual(IDENTITY);
        expect(config.speech?.endpoint).toBe("https://speech");
    });

    test("speech with unknown region falls through to extra", () => {
        const flat: FlatEnv = {
            SPEECH_SDK_KEY: "identity",
            SPEECH_SDK_REGION: "neverland",
        };
        const config = buildConfig(flat);
        expect(config.speech).toBeUndefined();
        expect(config.extra.get("SPEECH_SDK_REGION")).toBe("neverland");
    });

    test("ms graph with all three required fields", () => {
        const flat: FlatEnv = {
            MSGRAPH_APP_CLIENTID: "cid",
            MSGRAPH_APP_CLIENTSECRET: "secret",
            MSGRAPH_APP_TENANTID: "tid",
        };
        const config = buildConfig(flat);
        expect(config.msGraph?.clientId).toBe("cid");
        expect(config.msGraph?.clientSecret).toBe("secret");
        expect(config.msGraph?.tenantId).toBe("tid");
    });

    test("storage azure + cosmos", () => {
        const flat: FlatEnv = {
            AZURE_STORAGE_ACCOUNT: "acc",
            AZURE_STORAGE_CONTAINER: "cont",
            COSMOSDB_CONNECTION_STRING: "cs",
        };
        const config = buildConfig(flat);
        expect(config.storage.azure).toEqual({
            account: "acc",
            container: "cont",
        });
        expect(config.storage.database?.cosmosDbConnectionString).toBe("cs");
    });

    test("vault shared name", () => {
        const config = buildConfig({ TYPEAGENT_SHAREDVAULT: "aisystems" });
        expect(config.vault?.shared).toBe("aisystems");
    });
});

describe("buildConfig: extras passthrough", () => {
    test("unknown keys land in extra", () => {
        const flat: FlatEnv = {
            COMPLETELY_RANDOM_KEY: "value",
            ANOTHER_THING: "42",
        };
        const config = buildConfig(flat);
        expect(config.extra.get("COMPLETELY_RANDOM_KEY")).toBe("value");
        expect(config.extra.get("ANOTHER_THING")).toBe("42");
    });

    test("input map is not mutated", () => {
        const flat: FlatEnv = { AZURE_OPENAI_API_KEY: "identity" };
        const before = { ...flat };
        buildConfig(flat);
        expect(flat).toEqual(before);
    });
});
