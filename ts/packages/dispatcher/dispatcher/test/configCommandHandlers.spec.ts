// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
    getActiveModelProvider,
    getRuntimeConfig,
    setActiveModelProvider,
    setRuntimeConfig,
} from "@typeagent/aiclient";
import { applyModelProviderSelection } from "../src/context/system/handlers/modelProviderSelection.js";

describe("applyModelProviderSelection", () => {
    const originalModelProvider = process.env.TYPEAGENT_MODEL_PROVIDER;
    const originalEmbeddingProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    const originalEmbeddingModel = process.env.TYPEAGENT_EMBEDDING_MODEL;
    const originalConfig = getRuntimeConfig();
    const originalActiveProvider = getActiveModelProvider();

    afterEach(() => {
        restoreEnv("TYPEAGENT_MODEL_PROVIDER", originalModelProvider);
        restoreEnv("TYPEAGENT_EMBEDDING_PROVIDER", originalEmbeddingProvider);
        restoreEnv("TYPEAGENT_EMBEDDING_MODEL", originalEmbeddingModel);
        setRuntimeConfig(originalConfig);
        setActiveModelProvider(originalActiveProvider);
    });

    it("selects Copilot for chat and embeddings and rebuilds semantic routing", async () => {
        const rebuildActionSemanticMap = jest.fn<() => Promise<void>>();
        rebuildActionSemanticMap.mockResolvedValue();
        const clear = jest.fn();

        await applyModelProviderSelection("copilot", {
            agents: { rebuildActionSemanticMap } as any,
            translatorCache: { clear } as any,
        });

        expect(process.env.TYPEAGENT_MODEL_PROVIDER).toBe("copilot");
        expect(process.env.TYPEAGENT_EMBEDDING_PROVIDER).toBe("copilot");
        expect(process.env.TYPEAGENT_EMBEDDING_MODEL).toBe(
            "text-embedding-3-small",
        );
        expect(getRuntimeConfig().modelProvider).toBe("copilot");
        expect(getRuntimeConfig().embedding).toEqual({
            provider: "copilot",
            model: "text-embedding-3-small",
        });
        expect(rebuildActionSemanticMap).toHaveBeenCalledTimes(1);
        expect(clear).toHaveBeenCalledTimes(1);
    });

    it("preserves embedding configuration for other chat providers", async () => {
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "local";
        process.env.TYPEAGENT_EMBEDDING_MODEL = "custom-local-model";
        setRuntimeConfig({
            ...originalConfig,
            embedding: {
                provider: "local",
                model: "custom-local-model",
            },
        });
        const rebuildActionSemanticMap = jest.fn<() => Promise<void>>();
        const clear = jest.fn();

        await applyModelProviderSelection("openai", {
            agents: { rebuildActionSemanticMap } as any,
            translatorCache: { clear } as any,
        });

        expect(process.env.TYPEAGENT_MODEL_PROVIDER).toBe("openai");
        expect(process.env.TYPEAGENT_EMBEDDING_PROVIDER).toBe("local");
        expect(process.env.TYPEAGENT_EMBEDDING_MODEL).toBe(
            "custom-local-model",
        );
        expect(getRuntimeConfig().embedding).toEqual({
            provider: "local",
            model: "custom-local-model",
        });
        expect(rebuildActionSemanticMap).not.toHaveBeenCalled();
        expect(clear).toHaveBeenCalledTimes(1);
    });
});

function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
