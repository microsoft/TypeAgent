// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { buildConfig } from "@typeagent/config";
import {
    getActiveModelProvider,
    getRuntimeConfig,
    setActiveModelProvider,
    setRuntimeConfig,
} from "@typeagent/aiclient";
import { getConfiguredRunbookModelOptions } from "../src/runbookModelOptions.js";

describe("offline runbook model configuration query", () => {
    const previousConfig = getRuntimeConfig();
    const previousProvider = getActiveModelProvider();
    const fetch = jest
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => {
            throw new Error(
                "Network access forbidden in offline capability fixtures",
            );
        });

    beforeEach(() => {
        fetch.mockClear();
        setRuntimeConfig(
            buildConfig({
                TYPEAGENT_MODEL_PROVIDER: "azure",
                AZURE_OPENAI_API_KEY: "offline-fixture-not-a-secret",
                AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS:
                    "https://offline.example/openai/deployments/vision/chat/completions",
                AZURE_OPENAI_ENDPOINT_TEXT_ONLY_EASTUS:
                    "https://offline.example/openai/deployments/text/chat/completions",
            }),
        );
    });
    afterEach(() => {
        expect(fetch).not.toHaveBeenCalled();
    });
    afterAll(() => {
        setRuntimeConfig(previousConfig);
        setActiveModelProvider(previousProvider);
        fetch.mockRestore();
    });

    test("queries actual configured deployment presence without fetching keys or contacting a model", () => {
        expect(
            getConfiguredRunbookModelOptions({
                TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: "azure:GPT_4_O",
                TYPEAGENT_RUNBOOK_MULTIMODAL: "true",
            }),
        ).toEqual({
            runbookModelEndpoint: "azure:GPT_4_O",
            runbookMultimodal: true,
        });
    });

    test("configured text routes remain manual when declared unsupported", () => {
        expect(
            getConfiguredRunbookModelOptions({
                TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: "azure:TEXT_ONLY",
                TYPEAGENT_RUNBOOK_MULTIMODAL: "false",
            }),
        ).toEqual({
            runbookModelEndpoint: "azure:TEXT_ONLY",
            runbookMultimodal: false,
        });
    });

    test("configured vision-looking names do not invent support without a declaration", () => {
        expect(
            getConfiguredRunbookModelOptions({
                TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: "azure:GPT_4_O",
            }).runbookMultimodal,
        ).toBe(false);
    });

    test("does not allow an absent deployment to borrow the configured default fallback", () => {
        expect(() =>
            getConfiguredRunbookModelOptions({
                TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: "azure:ABSENT",
                TYPEAGENT_RUNBOOK_MULTIMODAL: "true",
            }),
        ).toThrow("not configured");
    });
});
