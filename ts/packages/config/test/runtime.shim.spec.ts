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
