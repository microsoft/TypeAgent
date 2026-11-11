// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getConfiguredViewModelOptions } from "../src/viewModelOptions.js";
import {
    createDurableMemoryService,
    configureDurableMemoryExtractionWindow,
    getConfiguredMemoryEmbeddingBatchSize,
    getConfiguredMemoryExtractionWindowSize,
} from "../src/durableMemoryService.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("native extraction windows retain the default and require an explicit treatment", () => {
    expect(getConfiguredMemoryExtractionWindowSize({})).toBe(8);
    for (const value of ["8", "16"])
        expect(
            getConfiguredMemoryExtractionWindowSize({
                TYPEAGENT_MEMORY_EXTRACTION_WINDOW_SIZE: value,
            }),
        ).toBe(Number(value));
});

test.each(["", " ", "0", "7", "9", "32", "16.0", " 16", "false"])(
    "invalid native extraction window fails explicitly: %j",
    (value) => {
        expect(() =>
            getConfiguredMemoryExtractionWindowSize({
                TYPEAGENT_MEMORY_EXTRACTION_WINDOW_SIZE: value,
            }),
        ).toThrow("Memory extraction window size must be 8 or 16.");
    },
);

test("default extraction keeps the original extractor identity", () => {
    const settings: Parameters<
        typeof configureDurableMemoryExtractionWindow
    >[0] = {
        batchSize: 32,
        autoExtractKnowledge: true,
        knowledgeExtractor: {
            settings: { maxContextLength: 2048 },
            extract: async () => undefined,
            extractWithRetry: async () => ({
                success: false,
                message: "fixture",
            }),
        },
    };
    const original = settings.knowledgeExtractor;
    configureDurableMemoryExtractionWindow(settings, 8);
    expect(settings.batchSize).toBe(8);
    expect(settings.knowledgeExtractor).toBe(original);
});

test("experimental extraction rejects a missing explicit extractor without partial mutation", () => {
    const settings = { batchSize: 8, autoExtractKnowledge: true };
    expect(() => configureDurableMemoryExtractionWindow(settings, 16)).toThrow(
        "require an explicit knowledge extractor",
    );
    expect(settings.batchSize).toBe(8);
});

test("both extraction methods share eight slots and preserve arguments, receivers, failures and results", async () => {
    const settings: Parameters<
        typeof configureDurableMemoryExtractionWindow
    >[0] = { batchSize: 8, autoExtractKnowledge: true };
    let active = 0;
    let peak = 0;
    const pending: (() => void)[] = [];
    const calls: unknown[][] = [];
    const work = async (args: unknown[]) => {
        calls.push(args);
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => pending.push(resolve));
        active--;
        if (args[0] === "message-0") throw new Error("fixture rejection");
    };
    const extractor: NonNullable<typeof settings.knowledgeExtractor> = {
        settings: { maxContextLength: 2048 },
        async extract(...args) {
            expect(this).toBe(extractor);
            await work(args);
            return undefined;
        },
        async extractWithRetry(...args) {
            expect(this).toBe(extractor);
            await work(args);
            return { success: false, message: "fixture negative result" };
        },
    };
    settings.knowledgeExtractor = extractor;
    configureDurableMemoryExtractionWindow(settings, 16);
    const wrapped = settings.knowledgeExtractor;
    expect(settings.batchSize).toBe(16);
    expect(wrapped.settings).toBe(extractor.settings);
    const context = [{ role: "user" as const, content: "unchanged context" }];
    const settled = Promise.allSettled(
        Array.from({ length: 24 }, (_, index) =>
            index % 2 === 0
                ? wrapped.extract(`message-${index}`)
                : wrapped.extractWithRetry(`message-${index}`, 2, context),
        ),
    );
    expect(active).toBe(8);
    while (pending.length > 0) {
        for (const release of pending.splice(0)) release();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const outcomes = await settled;
    expect(peak).toBe(8);
    expect(active).toBe(0);
    expect(calls).toHaveLength(24);
    expect(calls[1]).toEqual(["message-1", 2, context]);
    expect(calls[1][2]).toBe(context);
    expect(outcomes[0]).toMatchObject({
        status: "rejected",
        reason: new Error("fixture rejection"),
    });
    expect(outcomes[1]).toEqual({
        status: "fulfilled",
        value: { success: false, message: "fixture negative result" },
    });
    expect(outcomes[2]).toEqual({ status: "fulfilled", value: undefined });
});

test("native embedding batches retain the default and require an explicit investigated treatment", () => {
    expect(getConfiguredMemoryEmbeddingBatchSize({})).toBe(64);
    expect(
        getConfiguredMemoryEmbeddingBatchSize({
            TYPEAGENT_MEMORY_EMBEDDING_BATCH_SIZE: "64",
        }),
    ).toBe(64);
    expect(
        getConfiguredMemoryEmbeddingBatchSize({
            TYPEAGENT_MEMORY_EMBEDDING_BATCH_SIZE: "256",
        }),
    ).toBe(256);
});

test.each(["", " ", "0", "32", "257", "2048", "256.0", " 256", "false"])(
    "invalid native embedding treatment fails explicitly: %j",
    (value) => {
        expect(() =>
            getConfiguredMemoryEmbeddingBatchSize({
                TYPEAGENT_MEMORY_EMBEDDING_BATCH_SIZE: value,
            }),
        ).toThrow("Memory embedding batch size must be 64 or 256.");
    },
);

test("the host enables derived Views without an environment opt-in", async () => {
    const previous = process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS;
    delete process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS;
    const root = await mkdtemp(path.join(os.tmpdir(), "host-default-views-"));
    const service = createDurableMemoryService(root);
    try {
        expect((await service.getCapabilities()).derivedViews).toMatchObject({
            builds: true,
            informationalWiki: true,
            kinds: [
                "troubleshootingGuide",
                "projectBrief",
                "timeline",
                "wiki",
                "schemaView",
            ],
        });
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
        if (previous === undefined)
            delete process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS;
        else process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS = previous;
    }
});

test("explicit Views use only their own configured model endpoint", () => {
    const checked: string[] = [];
    const hasEndpoint = (endpoint: string) => {
        checked.push(endpoint);
        return endpoint === "azure:VIEW_MODEL";
    };
    expect(getConfiguredViewModelOptions({}, hasEndpoint)).toEqual({});
    expect(checked).toEqual([]);
    expect(
        getConfiguredViewModelOptions(
            {
                TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: "retired",
                TYPEAGENT_RUNBOOK_MULTIMODAL: "true",
            },
            hasEndpoint,
        ),
    ).toEqual({});
    expect(
        getConfiguredViewModelOptions(
            {
                TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT: " azure:VIEW_MODEL ",
            },
            hasEndpoint,
        ),
    ).toEqual({ viewModelEndpoint: "azure:VIEW_MODEL" });
    expect(() =>
        getConfiguredViewModelOptions(
            {
                TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT: "azure:MISSING",
            },
            hasEndpoint,
        ),
    ).toThrow("not available");
});

test("the native host configures initial reading independently of deeper answers", () => {
    const checked: string[] = [];
    expect(
        getConfiguredViewModelOptions(
            {
                TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT: " gpt_6_luna ",
                TYPEAGENT_MEMORY_INITIAL_READER_MODEL_ENDPOINT:
                    " gpt_6_1_terra ",
                TYPEAGENT_MEMORY_FAST_MODEL: "gpt_5_4_mini",
            },
            (endpoint) => {
                checked.push(endpoint);
                return true;
            },
        ),
    ).toEqual({
        viewModelEndpoint: "gpt_6_luna",
        initialReaderModelEndpoint: "gpt_6_1_terra",
    });
    expect(checked).toEqual(["gpt_6_luna", "gpt_6_1_terra"]);
    expect(
        getConfiguredViewModelOptions(
            {
                TYPEAGENT_MEMORY_INITIAL_READER_MODEL_ENDPOINT: "gpt_6_luna",
            },
            () => true,
        ),
    ).toEqual({ initialReaderModelEndpoint: "gpt_6_luna" });
});

test.each(["", " ", "missing"])(
    "an unavailable or empty explicit initial reader rejects: %j",
    (endpoint) => {
        expect(() =>
            getConfiguredViewModelOptions(
                { TYPEAGENT_MEMORY_INITIAL_READER_MODEL_ENDPOINT: endpoint },
                () => false,
            ),
        ).toThrow("initial reader model endpoint is not available");
    },
);
