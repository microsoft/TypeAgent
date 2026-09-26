// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getActiveModelProvider,
    resolveTarget,
    setActiveModelProvider,
    usesProviderDefault,
} from "../src/providerMode.js";

describe("Copilot provider mode", () => {
    const configuredProvider = process.env.TYPEAGENT_MODEL_PROVIDER;

    afterEach(() => {
        setActiveModelProvider(undefined);
        if (configuredProvider === undefined) {
            delete process.env.TYPEAGENT_MODEL_PROVIDER;
        } else {
            process.env.TYPEAGENT_MODEL_PROVIDER = configuredProvider;
        }
    });

    test("uses the environment across independently bundled aiclient copies", () => {
        process.env.TYPEAGENT_MODEL_PROVIDER = "COPILOT";

        expect(getActiveModelProvider()).toBe("copilot");
    });

    test("prefers an explicitly initialized provider", () => {
        process.env.TYPEAGENT_MODEL_PROVIDER = "copilot";
        setActiveModelProvider("openai");

        expect(getActiveModelProvider()).toBe("openai");
    });

    test("uses the provider-configured model for default and unknown names", () => {
        expect(usesProviderDefault("DEFAULT")).toBe(true);
        expect(usesProviderDefault("unknown-model-alias")).toBe(true);
    });

    test.each([
        ["DEFAULT", "gpt-5.6-luna"],
        ["GPT_35_TURBO", "gpt-5.6-luna"],
        ["GPT_4_O", "gpt-5.6-sol"],
        ["GPT_5", "gpt-5.6-sol"],
        ["GPT_5_MINI", "gpt-5.6-terra"],
        ["GPT_5_NANO", "gpt-5.6-luna"],
        ["GPT_5_6_LUNA", "gpt-5.6-luna"],
        ["gpt_5_6_luna", "gpt-5.6-luna"],
        ["GPT_V", "gpt-5.6-sol"],
    ])("maps %s to %s", (canonical, expected) => {
        expect(resolveTarget("copilot", canonical)).toBe(expected);
    });

    test("keeps explicit canonical model mappings", () => {
        expect(usesProviderDefault("GPT_4_O")).toBe(false);
        expect(usesProviderDefault("GPT_5_6_LUNA")).toBe(false);
        expect(usesProviderDefault("gpt_5_6_luna")).toBe(false);
    });
});

describe("GPT_5_6_LUNA provider mappings", () => {
    test.each(["azure", "openai"] as const)(
        "preserves the deployment name in %s mode",
        (mode) => {
            expect(resolveTarget(mode, "GPT_5_6_LUNA")).toBe("GPT_5_6_LUNA");
        },
    );

    test("preserves the default local model in Ollama mode", () => {
        expect(resolveTarget("ollama", "GPT_5_6_LUNA")).toBe(
            resolveTarget("ollama", "DEFAULT"),
        );
    });
});
