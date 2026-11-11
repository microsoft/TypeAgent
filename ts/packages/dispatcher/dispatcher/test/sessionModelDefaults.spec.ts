// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    configFromEnvRecord,
    getRuntimeConfig,
    openai,
    resolveTarget,
    setRuntimeConfig,
} from "@typeagent/aiclient";
import { Session } from "../src/context/session.js";
import { resolveTranslationModelSettings } from "../src/translation/translateRequest.js";

describe("session translation model", () => {
    test("defaults to GPT_6_LUNA and resolves to GPT-6 Luna in Copilot mode", async () => {
        const session = await Session.create();
        const model = session.getConfig().translation.model;
        expect(model).toBe(openai.GPT_6_LUNA);
        expect(resolveTarget("copilot", model)).toBe("gpt-6-luna");
        expect(session.getConfig().translation.reasoningEffort).toBe("medium");
    });

    test("preserves an explicit model and restores Luna on reset", async () => {
        const session = await Session.create({
            translation: { model: "GPT_4_O" },
        });
        expect(session.getConfig().translation.model).toBe("GPT_4_O");
        expect(resolveTarget("copilot", "GPT_4_O")).toBe("gpt-6-sol");

        session.updateSettings({
            translation: { model: null, reasoningEffort: "high" },
        });
        expect(session.getConfig().translation.model).toBe(openai.GPT_6_LUNA);
        expect(session.getConfig().translation.reasoningEffort).toBe("high");
        expect(
            resolveTarget("copilot", session.getConfig().translation.model),
        ).toBe("gpt-6-luna");
    });
});

describe("translation model fallback", () => {
    const originalConfig = getRuntimeConfig();

    afterEach(() => {
        setRuntimeConfig(originalConfig);
    });

    test("fails clearly rather than falling back from Luna to GPT-4.1", () => {
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_4_1_EASTUS: "https://gpt-4-1",
                AZURE_OPENAI_API_KEY_GPT_4_1_EASTUS: "identity",
            }),
        );

        expect(() =>
            resolveTranslationModelSettings(openai.GPT_6_LUNA, "medium"),
        ).toThrow(/GPT-6 Luna endpoint/);
    });

    test("falls back to Luna and preserves reasoning when a requested endpoint is missing", () => {
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS: "https://gpt-6-luna",
                AZURE_OPENAI_API_KEY_GPT_6_LUNA_EASTUS: "identity",
            }),
        );
        expect(
            resolveTranslationModelSettings("UNAVAILABLE_MODEL", "medium"),
        ).toEqual({
            model: openai.GPT_6_LUNA,
            reasoningEffort: "medium",
        });
    });

    test("preserves an explicitly selected available older model", () => {
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_4_1_EASTUS: "https://gpt-4-1",
                AZURE_OPENAI_API_KEY_GPT_4_1_EASTUS: "identity",
            }),
        );
        expect(
            resolveTranslationModelSettings(openai.GPT_4_1, undefined),
        ).toEqual({
            model: openai.GPT_4_1,
            reasoningEffort: undefined,
        });
    });

    test("preserves reasoning effort when the configured model is available", () => {
        setRuntimeConfig(
            configFromEnvRecord({
                AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS: "https://gpt-6-luna",
                AZURE_OPENAI_API_KEY_GPT_6_LUNA_EASTUS: "identity",
            }),
        );

        expect(
            resolveTranslationModelSettings(openai.GPT_6_LUNA, "medium"),
        ).toEqual({
            model: openai.GPT_6_LUNA,
            reasoningEffort: "medium",
        });
    });
});
