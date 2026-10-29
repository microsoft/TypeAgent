// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    configFromEnvRecord,
    getRuntimeConfig,
    setRuntimeConfig,
} from "@typeagent/aiclient";
import {
    createDocMemorySettings,
    type DocMemorySettings,
} from "@typeagent/conversation-memory";
import {
    runWithSearchCancellation,
    type SearchQueryTranslator,
} from "@typeagent/knowpro";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { MaintenanceScheduler } from "../src/maintenanceScheduler.js";
import {
    boundedSupportMap,
    memoryPerformanceExperiments,
} from "../src/memoryPerformanceExperiments.js";
import { TranslationCache } from "../src/translationCache.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { ConsolidationIndex } from "./wikiConsolidationFixtures.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import type { AnswerEvidence, IndexedFragmentRequest } from "../src/types.js";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((finish) => {
        resolve = finish;
    });
    return { promise, resolve };
}

describe("bounded serving experiments", () => {
    test("the actual fast-query factory retains JSON output mode on the wire", async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), "fast-query-json-"));
        const originalConfig = getRuntimeConfig();
        const originalFetch = globalThis.fetch;
        let service: FileMemoryService | undefined;
        let settings: DocMemorySettings | undefined;
        let body: Record<string, unknown> | undefined;
        try {
            setRuntimeConfig(
                configFromEnvRecord({
                    TYPEAGENT_MODEL_PROVIDER: "azure",
                    TYPEAGENT_EMBEDDING_PROVIDER: "none",
                    AZURE_OPENAI_API_KEY: "offline-fixture",
                    AZURE_OPENAI_RESPONSE_FORMAT: "1",
                    AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS:
                        "https://example.test/openai/deployments/extraction/chat/completions",
                    AZURE_OPENAI_ENDPOINT_GPT_5_4_MINI_EASTUS:
                        "https://example.test/openai/deployments/query/chat/completions",
                }),
            );
            globalThis.fetch = async (url, init) => {
                expect(String(url)).toContain("/deployments/query/");
                body = JSON.parse(String(init?.body)) as Record<
                    string,
                    unknown
                >;
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { content: "{}" } }],
                    }),
                    { status: 200 },
                );
            };
            service = new FileMemoryService(root, {
                maintenanceMode: "manual",
                informationalViews: false,
                sourceSynopses: false,
                performanceExperiments: "fast-models",
                fastQueryModelEndpoint: "gpt_5_4_mini",
                indexSettingsFactory: () => {
                    settings = createDocMemorySettings();
                    return settings;
                },
            });
            const { corpusId } = await service.createCorpus("Fast query JSON");
            await service.search({ corpusId, query: "recorded gallery" });
            if (!settings?.queryLanguageModel)
                throw new Error("Fast query model was not installed");
            expect(settings.queryLanguageModel).not.toBe(
                settings.languageModel,
            );
            expect(
                (await settings.queryLanguageModel.complete("Return JSON."))
                    .success,
            ).toBe(true);
            expect(body?.response_format).toEqual({ type: "json_object" });
        } finally {
            await service?.close();
            globalThis.fetch = originalFetch;
            setRuntimeConfig(originalConfig);
            await rm(root, { recursive: true, force: true });
        }
    });

    test("presets are explicit and unknown switches fail closed", () => {
        expect(memoryPerformanceExperiments("").size).toBe(0);
        expect(memoryPerformanceExperiments("p2").size).toBe(5);
        expect(memoryPerformanceExperiments("p3").size).toBe(4);
        expect(memoryPerformanceExperiments("p2,p3").size).toBe(9);
        expect(() => memoryPerformanceExperiments("typo")).toThrow("Unknown");
        expect(
            () =>
                new FileMemoryService("unused", {
                    initialReaderModelEndpoint: " ",
                }),
        ).toThrow("initialReaderModelEndpoint");
        expect(
            () =>
                new FileMemoryService("unused", {
                    performanceExperiments: "fast-models",
                    fastQueryModelEndpoint: "",
                }),
        ).toThrow("explicitly configured");
    });

    test("completed translations isolate schema, corpus, model, exact context and returned mutations", async () => {
        let calls = 0;
        const inner: SearchQueryTranslator = {
            translate: async () => {
                calls++;
                return { success: true, data: { searchExpressions: [] } };
            },
            translate2: async () => {
                calls++;
                return { success: true, data: { searchExpressions: [] } };
            },
        };
        const cache = new TranslationCache();
        const translator = cache.wrap("one", "model1", inner);
        const first = await translator.translate("gallery", "context");
        if (first.success) Object.assign(first.data, { corrupted: true });
        expect(await translator.translate("gallery", "context")).toEqual({
            success: true,
            data: { searchExpressions: [] },
        });
        expect(calls).toBe(1);
        await translator.translate("gallery", "other-context");
        await translator.translate("Gallery", "context");
        await translator.translate2!("gallery", "context");
        await cache
            .wrap("two", "model1", inner)
            .translate("gallery", "context");
        await cache
            .wrap("one", "model2", inner)
            .translate("gallery", "context");
        expect(calls).toBe(6);
        cache.close();
        await expect(translator.translate("gallery")).rejects.toThrow("closed");
    });

    test("failures, relative dates, absolute expiry and entry bounds do not become permanent hits", async () => {
        let calls = 0;
        let fail = true;
        let now = 0;
        const cache = new TranslationCache(() => now);
        const translator = cache.wrap("corpus", "model", {
            translate: async () => {
                calls++;
                return fail
                    ? { success: false, message: "offline failure" }
                    : { success: true, data: { searchExpressions: [] } };
            },
        });
        await translator.translate("gallery");
        fail = false;
        await translator.translate("gallery");
        await translator.translate("gallery");
        expect(calls).toBe(2);
        now = 5 * 60_000;
        await translator.translate("gallery");
        expect(calls).toBe(3);
        await translator.translate("today");
        await translator.translate("today");
        expect(calls).toBe(5);
        for (let index = 0; index < 129; index++)
            await translator.translate(`entry ${index}`);
        const before = calls;
        await translator.translate("gallery");
        expect(calls).toBe(before + 1);
        cache.close();
    });

    test("privacy invalidation and cancellation prevent late population without sharing caller signals", async () => {
        const gate = deferred();
        let calls = 0;
        const cache = new TranslationCache();
        const translator = cache.wrap("corpus", "model", {
            translate: async () => {
                calls++;
                await gate.promise;
                return { success: true, data: { searchExpressions: [] } };
            },
        });
        const controller = new AbortController();
        const cancelled = runWithSearchCancellation(controller.signal, () =>
            translator.translate("gallery"),
        );
        const rejected = expect(cancelled).rejects.toThrow("cancelled");
        const independent = translator.translate("gallery");
        cache.invalidate("corpus");
        controller.abort(new Error("cancelled"));
        gate.resolve();
        await rejected;
        expect((await independent).success).toBe(true);
        expect(calls).toBe(2);
        await translator.translate("gallery");
        expect(calls).toBe(3);
        await translator.translate("gallery");
        expect(calls).toBe(3);
        cache.close();
    });

    test("graph work preserves order, bounds concurrency and settles siblings before propagating failure", async () => {
        let active = 0;
        let maximum = 0;
        expect(
            await boundedSupportMap([1, 2, 3], 2, async (value) => {
                active++;
                maximum = Math.max(maximum, active);
                await new Promise<void>((resolve) => setImmediate(resolve));
                active--;
                return value * 2;
            }),
        ).toEqual([2, 4, 6]);
        expect(maximum).toBe(2);
        const gate = deferred();
        let settled = false;
        const started: number[] = [];
        const pending = boundedSupportMap([1, 2, 3], 2, async (value) => {
            started.push(value);
            if (value === 1) throw new Error("support failed");
            await gate.promise;
            return value;
        }).finally(() => {
            settled = true;
        });
        const rejected = expect(pending).rejects.toThrow("support failed");
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(settled).toBe(false);
        gate.resolve();
        await rejected;
        expect(started).toEqual([1, 2]);
    });

    test("foreground maintenance hold expires after ten seconds even while requests remain active", async () => {
        const clock = (import.meta as ImportMeta & { jest: typeof jest }).jest;
        clock.useFakeTimers();
        const scheduler = new MaintenanceScheduler(() => false);
        const gate = deferred();
        try {
            const first = scheduler.foreground(() => gate.promise);
            expect(scheduler.status().paused).toBe(true);
            await scheduler.foreground(async () => {});
            expect(scheduler.status().paused).toBe(true);
            await clock.advanceTimersByTimeAsync(10_000);
            expect(scheduler.status().paused).toBe(false);
            await scheduler.foreground(async () => {
                expect(scheduler.status().paused).toBe(false);
            });
            await clock.advanceTimersByTimeAsync(1000);
            await scheduler.foreground(async () => {
                expect(scheduler.status().paused).toBe(true);
            });
            gate.resolve();
            await first;
            expect(scheduler.status().paused).toBe(false);
        } finally {
            gate.resolve();
            await scheduler.close();
            clock.useRealTimers();
        }
    });

    test("lazy collection listing loads no runtimes and concurrent first opens initialize once", async () => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "memory-lazy-serving-"),
        );
        const loaded: string[] = [];
        const options = {
            maintenanceMode: "manual" as const,
            sourceSynopses: false,
            informationalViews: false,
            indexFactory: (id: string, directory: string) => {
                loaded.push(id);
                return new FakeSemanticCorpusIndex(directory);
            },
        };
        let service = new FileMemoryService(root, options);
        try {
            const first = await service.createCorpus("first");
            const second = await service.createCorpus("second");
            await service.close();
            loaded.length = 0;
            service = new FileMemoryService(root, {
                ...options,
                performanceExperiments: "lazy-collections",
            });
            await service.initialize();
            expect(loaded).toEqual([]);
            expect(await service.listCorpora()).toHaveLength(2);
            expect(loaded).toEqual([]);
            const opened = await Promise.all([
                service.getCorpus(first.corpusId),
                service.getCorpus(first.corpusId),
            ]);
            expect(opened.every((item) => item?.name === "first")).toBe(true);
            expect(loaded.filter((id) => id === first.corpusId)).toHaveLength(
                1,
            );
            expect(loaded.includes(second.corpusId)).toBe(false);
            const job = await service.ingestDocument({
                corpusId: second.corpusId,
                source: {
                    sourceId: "first-write",
                    sourceType: "text",
                    title: "first write",
                    text: "First access is a write.",
                },
            });
            expect(
                (
                    await waitForMemoryJob(service, job.jobId, {
                        pollIntervalMs: 5,
                    })
                ).state,
            ).toBe("complete");
        } finally {
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe("provisional sources and bounded exact-evidence leases", () => {
    function snapshotId(result: { evidenceSnapshotId?: string }): string {
        if (!result.evidenceSnapshotId)
            throw new Error("Missing prepared evidence");
        return result.evidenceSnapshotId;
    }
    let root: string;
    let service: FileMemoryService;
    let corpusId: string;
    let modelCalls: number;
    let fragmentReads: IndexedFragmentRequest[];
    const clock = (import.meta as ImportMeta & { jest: typeof jest }).jest;

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-evidence-leases-"));
        modelCalls = 0;
        fragmentReads = [];
        service = new FileMemoryService(root, {
            performanceExperiments: "source-preview,evidence-leases",
            maintenanceMode: "manual",
            sourceSynopses: false,
            informationalViews: false,
            curatedTopics: false,
            discoveryPolicy: "off",
            understanding: true,
            indexFactory: (_id, directory) =>
                new (class extends ConsolidationIndex {
                    override async readFragments(
                        input: IndexedFragmentRequest,
                    ) {
                        fragmentReads.push(input);
                        return super.readFragments(input);
                    }
                })(directory),
            indexedAnswerModel: {
                completionSettings: {},
                complete: async (prompt) => {
                    modelCalls++;
                    if (typeof prompt === "string")
                        throw new Error("Expected evidence envelope");
                    const content = prompt[prompt.length - 1].content;
                    if (typeof content !== "string")
                        throw new Error("Expected text");
                    const input = JSON.parse(content) as {
                        evidence: AnswerEvidence[];
                    };
                    return {
                        success: true,
                        data: JSON.stringify({
                            status: "answered",
                            answer: "The user reported six gallery projects.",
                            evidenceIds: input.evidence.map((item) => item.id),
                            retrievalQueries: [],
                        }),
                    };
                },
            },
        });
        corpusId = (await service.createCorpus("lease fixture")).corpusId;
        await ingest("original", "The user reported six gallery projects.");
    });

    async function ingest(sourceId: string, text: string) {
        const job = await service.ingestDocument({
            corpusId,
            source: {
                sourceId,
                sourceType: "text",
                title: sourceId,
                text,
            },
        });
        expect(
            (
                await waitForMemoryJob(service, job.jobId, {
                    pollIntervalMs: 5,
                })
            ).state,
        ).toBe("complete");
    }

    afterEach(async () => {
        clock.restoreAllMocks();
        await service.close();
        await rm(root, { recursive: true, force: true });
    });

    test("preview performs bounded lexical retrieval without a model and cannot become a module handle", async () => {
        const preview = await service.understand({
            corpusId,
            question: "gallery",
            phase: "preview",
        });
        expect(modelCalls).toBe(0);
        expect(preview.provisional).toBe(true);
        expect(preview.answer).toBeUndefined();
        expect(preview.evidenceSnapshotId).toBeUndefined();
        expect(preview.citations).toHaveLength(1);
        expect(fragmentReads).toHaveLength(1);
        expect(fragmentReads[0]).not.toHaveProperty("query");
        expect(fragmentReads[0]).toMatchObject({
            maxFragments: 6,
            maxCharsPerFragment: 600,
            maxReadChars: 6000,
            sourceIds: ["original"],
        });
        await expect(
            service.understandingModule({
                corpusId,
                snapshotId: preview.snapshotId,
                kind: "sources",
            }),
        ).rejects.toThrow("expired or unavailable");
    });

    test("an unrelated generation can reuse exact evidence, but leases never refresh and clear revokes immediately", async () => {
        const question = "gallery";
        const prepared = await service.answer({
            corpusId,
            question,
            prepareOnly: true,
        });
        expect(prepared.evidenceSnapshotId).toBeDefined();
        const startedAt = Date.now();
        await ingest("unrelated", "A different retained source.");
        const now = clock
            .spyOn(Date, "now")
            .mockReturnValue(startedAt + 60_000);
        const initial = await service.answer({
            corpusId,
            question,
            deferRefinement: true,
            evidenceSnapshotId: snapshotId(prepared),
        });
        expect(initial.mode).toBe("synthesized");
        now.mockReturnValue(startedAt + 120_001);
        await expect(
            service.answer({
                corpusId,
                question,
                deferRefinement: true,
                evidenceSnapshotId: snapshotId(initial),
            }),
        ).rejects.toThrow("changed or was forgotten");
        now.mockRestore();
        const fresh = await service.answer({
            corpusId,
            question,
            prepareOnly: true,
        });
        await service.clearCorpus(corpusId);
        await expect(
            service.answer({
                corpusId,
                question,
                evidenceSnapshotId: snapshotId(fresh),
            }),
        ).rejects.toThrow("expired or unavailable");
    });

    test("source knowledge suppression still revokes a live exact-evidence lease", async () => {
        const prepared = await service.answer({
            corpusId,
            question: "gallery",
            prepareOnly: true,
        });
        await service.suppressSourceKnowledge({
            corpusId,
            sourceId: "original",
            kind: "topic",
            name: "gallery",
        });
        await expect(
            service.answer({
                corpusId,
                question: "gallery",
                evidenceSnapshotId: snapshotId(prepared),
            }),
        ).rejects.toThrow();
    });
});
