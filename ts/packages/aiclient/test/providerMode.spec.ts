// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { resolveTarget, usesProviderDefault } from "../src/providerMode.js";

describe("Copilot provider mode", () => {
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
        ["GPT_V", "gpt-5.6-sol"],
    ])("maps %s to %s", (canonical, expected) => {
        expect(resolveTarget("copilot", canonical)).toBe(expected);
    });

    test("keeps explicit canonical model mappings", () => {
        expect(usesProviderDefault("GPT_4_O")).toBe(false);
    });
});
