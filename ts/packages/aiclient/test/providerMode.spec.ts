// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { resolveTarget, usesProviderDefault } from "../src/providerMode.js";

describe("Copilot provider mode", () => {
    test("uses the provider-configured model for default and unknown names", () => {
        expect(usesProviderDefault("DEFAULT")).toBe(true);
        expect(usesProviderDefault("unknown-model-alias")).toBe(true);
    });

    test("maps canonical translation models to Haiku 4.5", () => {
        expect(resolveTarget("copilot", "DEFAULT")).toBe("claude-haiku-4.5");
        expect(resolveTarget("copilot", "GPT_5")).toBe("claude-haiku-4.5");
    });

    test("keeps explicit canonical model mappings", () => {
        expect(usesProviderDefault("GPT_4_O")).toBe(false);
        expect(resolveTarget("copilot", "GPT_4_O")).toBe("gpt-5.4");
    });
});
