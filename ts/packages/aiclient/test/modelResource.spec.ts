// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getChatModelNames,
    setRuntimeConfig,
    configFromEnvRecord,
} from "../src/index.js";
import { _resetRuntimeConfigForTests } from "../src/runtimeConfig.js";

describe("getChatModelNames: typed-Config-driven enumeration", () => {
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
