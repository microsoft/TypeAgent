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
        ["DEFAULT", "gpt-6-luna"],
        ["GPT_35_TURBO", "gpt-6-luna"],
        ["GPT_4_O", "gpt-6-sol"],
        ["GPT_5", "gpt-6.1-terra"],
        ["GPT_5_MINI", "gpt-6-luna"],
        ["GPT_5_NANO", "gpt-6-luna"],
        ["GPT_6_LUNA", "gpt-6-luna"],
        ["gpt_6_luna", "gpt-6-luna"],
        ["GPT_6_1_SOL", "gpt-6.1-sol"],
        ["GPT_6_1_TERRA", "gpt-6.1-terra"],
        ["gpt_6_1_terra", "gpt-6.1-terra"],
        ["GPT_V", "gpt-6-sol"],
    ])("maps %s to %s", (canonical, expected) => {
        expect(resolveTarget("copilot", canonical)).toBe(expected);
    });

    test("keeps explicit canonical model mappings", () => {
        expect(usesProviderDefault("GPT_4_O")).toBe(false);
        expect(usesProviderDefault("GPT_6_LUNA")).toBe(false);
        expect(usesProviderDefault("gpt_6_luna")).toBe(false);
        expect(usesProviderDefault("GPT_6_1_SOL")).toBe(false);
        expect(usesProviderDefault("GPT_6_1_TERRA")).toBe(false);
    });
});

describe.each(["GPT_6_LUNA", "GPT_6_1_SOL", "GPT_6_1_TERRA"])(
    "%s provider mappings",
    (model) => {
        test.each(["azure", "openai"] as const)(
            "preserves the deployment name in %s mode",
            (mode) => {
                expect(resolveTarget(mode, model)).toBe(model);
            },
        );

        test("preserves the equivalent local model in Ollama mode", () => {
            expect(resolveTarget("ollama", model)).toBe(
                resolveTarget(
                    "ollama",
                    model === "GPT_6_LUNA" ? "DEFAULT" : "GPT_5",
                ),
            );
        });
    },
);
