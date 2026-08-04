// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    applyToProcessEnv,
    buildConfig,
    configToEnv,
    type FlatEnv,
} from "../src/index.js";

describe("configToEnv: shim projection", () => {
    test("round-trips Azure OpenAI deployment endpoints", () => {
        const flat: FlatEnv = {
            AZURE_OPENAI_API_KEY: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://4o-east",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDENCENTRAL_PTU:
                "https://4o-sw-ptu",
            AZURE_OPENAI_API_KEY_GPT_4_O_SWEDENCENTRAL_PTU: "identity",
        };
        const projected = configToEnv(buildConfig(flat));
        for (const [k, v] of Object.entries(flat)) {
            expect(projected[k]).toBe(v);
        }
    });

    test("round-trips a non-default wireApi through the POOL override", () => {
        // A non-default wireApi must survive buildConfig -> configToEnv so
        // that an unmigrated consumer reading the flat env sees it. The
        // POOL override is the only channel that can express wireApi.
        const flat: FlatEnv = {
            AZURE_OPENAI_ENDPOINT_GPT_5_CODEX_EASTUS: "https://codex-eastus",
            AZURE_OPENAI_API_KEY_GPT_5_CODEX_EASTUS: "identity",
            AZURE_OPENAI_POOL_GPT_5_CODEX:
                "[{suffix:GPT_5_CODEX_EASTUS,region:eastus,mode:PAYG,priority:2,wireApi:openai_responses}]",
        };
        const projected = configToEnv(buildConfig(flat));
        expect(projected.AZURE_OPENAI_ENDPOINT_GPT_5_CODEX_EASTUS).toBe(
            "https://codex-eastus",
        );
        // The emitted POOL override carries the wireApi back out.
        expect(projected.AZURE_OPENAI_POOL_GPT_5_CODEX).toContain(
            "wireApi:openai_responses",
        );
        // And feeding the projection back in yields the same wireApi.
        const reparsed = buildConfig(projected);
        const ep = reparsed.azureOpenAI.deployments
            .get("gpt_5_codex")!
            .endpoints.find((e) => e.region === "eastus")!;
        expect(ep.wireApi).toBe("openai_responses");
    });

    test("default (omitted) wireApi is not emitted into the POOL override", () => {
        // Back-compat: a plain chat_completions endpoint must project to the
        // exact same env it came from, with no POOL override introduced.
        const flat: FlatEnv = {
            AZURE_OPENAI_API_KEY: "identity",
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS: "https://4o-east",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS: "identity",
        };
        const projected = configToEnv(buildConfig(flat));
        for (const [k, v] of Object.entries(flat)) {
            expect(projected[k]).toBe(v);
        }
        expect(projected.AZURE_OPENAI_POOL_GPT_4_O).toBeUndefined();
    });

    test("emits tuning knobs as strings, response_format as 1/0", () => {
        const config = buildConfig({
            AZURE_OPENAI_RESPONSE_FORMAT: "1",
            AZURE_OPENAI_MAX_CONCURRENCY: "8",
        });
        const out = configToEnv(config);
        expect(out.AZURE_OPENAI_RESPONSE_FORMAT).toBe("1");
        expect(out.AZURE_OPENAI_MAX_CONCURRENCY).toBe("8");
        expect(out.AZURE_OPENAI_MAX_TIMEOUT).toBe("60000");
        expect(out.AZURE_OPENAI_MAX_RETRYATTEMPTS).toBe("3");
    });

    test("round-trips the embedding provider section", () => {
        const flat: FlatEnv = {
            TYPEAGENT_EMBEDDING_PROVIDER: "local",
            TYPEAGENT_EMBEDDING_MODEL: "Xenova/all-MiniLM-L6-v2",
            TYPEAGENT_EMBEDDING_CACHE_DIR: "/var/lib/typeagent/models",
        };
        const config = buildConfig(flat);
        expect(config.embedding).toEqual({
            provider: "local",
            model: "Xenova/all-MiniLM-L6-v2",
            cacheDir: "/var/lib/typeagent/models",
        });
        const out = configToEnv(config);
        for (const [k, v] of Object.entries(flat)) {
            expect(out[k]).toBe(v);
        }
    });

    test("leaves an unknown embedding provider value in extras", () => {
        const out = configToEnv(
            buildConfig({ TYPEAGENT_EMBEDDING_PROVIDER: "bogus" }),
        );
        expect(out.TYPEAGENT_EMBEDDING_PROVIDER).toBe("bogus");
    });

    test("preserves extras verbatim", () => {
        const flat: FlatEnv = {
            AZURE_FOUNDRY_AGENT_ID_FOO: "asst_xyz",
            CUSTOM_THING: "whatever",
        };
        const out = configToEnv(buildConfig(flat));
        expect(out.AZURE_FOUNDRY_AGENT_ID_FOO).toBe("asst_xyz");
        expect(out.CUSTOM_THING).toBe("whatever");
    });

    test("typed values for unmigrated extra keys: explicit extras win", () => {
        // If both a typed value and an extras override exist, extras win
        // (because we haven't decided to lock the typed value yet).
        // Here AZURE_OPENAI_RESPONSE_FORMAT is typed, but if a user puts
        // it in the input, we read it through the typed path. The extras
        // override path applies only to keys we don't recognize.
        const flat: FlatEnv = {
            AZURE_OPENAI_RESPONSE_FORMAT: "1",
        };
        const out = configToEnv(buildConfig(flat));
        expect(out.AZURE_OPENAI_RESPONSE_FORMAT).toBe("1");
    });
});

describe("applyToProcessEnv", () => {
    test("does not overwrite existing env values by default", () => {
        const target: NodeJS.ProcessEnv = {
            AZURE_OPENAI_MAX_CONCURRENCY: "99",
        };
        const config = buildConfig({});
        applyToProcessEnv(config, { target });
        // Existing value preserved.
        expect(target.AZURE_OPENAI_MAX_CONCURRENCY).toBe("99");
    });

    test("overwrite=true replaces existing env values", () => {
        const target: NodeJS.ProcessEnv = {
            AZURE_OPENAI_MAX_CONCURRENCY: "99",
        };
        const config = buildConfig({});
        applyToProcessEnv(config, { target, overwrite: true });
        expect(target.AZURE_OPENAI_MAX_CONCURRENCY).toBe("4");
    });

    test("populates only typed + extra keys, not random globals", () => {
        const target: NodeJS.ProcessEnv = { PATH: "/should/stay" };
        const config = buildConfig({
            AZURE_OPENAI_API_KEY: "identity",
            CUSTOM_KEY: "v",
        });
        applyToProcessEnv(config, { target });
        expect(target.PATH).toBe("/should/stay");
        expect(target.AZURE_OPENAI_API_KEY).toBe("identity");
        expect(target.CUSTOM_KEY).toBe("v");
    });
});
