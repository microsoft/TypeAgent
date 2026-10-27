// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { getConfiguredMemoryViewOptions } from "../src/viewHostOptions.js";
import { runMemoryViewsCli } from "../src/memoryViewsCli.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { selectIndexedFragments } from "../src/indexedFragments.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import type { IndexedFragmentRequest } from "../src/types.js";
import type { ViewSynthesisOutput } from "../src/viewTypes.js";

test("topic experiments are opt-in and reject invalid host settings", () => {
    expect(getConfiguredMemoryViewOptions({})).not.toHaveProperty(
        "topicCuration",
    );
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_TOPIC_INPUT_TOKENS: "32000",
            TYPEAGENT_MEMORY_TOPIC_CONCURRENCY: "2",
            TYPEAGENT_MEMORY_TOPIC_PRIOR_FRACTION: "0.25",
        }).topicCuration,
    ).toEqual({
        inputTokenTarget: 32000,
        concurrency: 2,
        priorContextFraction: 0.25,
    });
    for (const environment of [
        { TYPEAGENT_MEMORY_TOPIC_INPUT_TOKENS: "" },
        { TYPEAGENT_MEMORY_TOPIC_INPUT_TOKENS: "NaN" },
        { TYPEAGENT_MEMORY_TOPIC_CONCURRENCY: "3" },
        { TYPEAGENT_MEMORY_TOPIC_PRIOR_FRACTION: "0.2" },
        { TYPEAGENT_MEMORY_TOPIC_INPUT_TOKENS: "-1" },
    ])
        expect(() => getConfiguredMemoryViewOptions(environment)).toThrow();
});

test("generative and native execution families retain distinct capacities and reject conflicting activation", () => {
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_CONCURRENCY: "24",
            TYPEAGENT_MEMORY_TOPIC_CONCURRENCY: "2",
        }),
    ).toMatchObject({
        decisionTopicExecution: { concurrency: 24 },
        topicCuration: { concurrency: 2 },
    });
    expect(() =>
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_TOPICS: "true",
            TYPEAGENT_MEMORY_TOPIC_CONCURRENCY: "2",
        }),
    ).toThrow("cannot configure Decision");
    for (const options of [{ decisionTopics: true }, { curatedTopics: false }])
        expect(
            () =>
                new FileMemoryService("unused", {
                    ...options,
                    topicCuration: { concurrency: 2 },
                }),
        ).toThrow("Generative topic settings require");
});

class DeadlineCorpusIndex extends FakeSemanticCorpusIndex {
    public async readFragments(request: IndexedFragmentRequest) {
        return selectIndexedFragments(
            this.documents.map((document) => ({
                sourceId: document.source.sourceId,
                revisionId: document.revision.revisionId,
                blockOrdinal: 0,
                text: document.content,
                score: 1,
            })),
            request,
        );
    }
}

test("Decision execution environment validates bounded concurrency, lookahead and context sizing", () => {
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_FULL_TRANSACTIONS: "true",
            TYPEAGENT_MEMORY_DECISION_CONCURRENCY: "24",
        }).decisionTopicExecution,
    ).toMatchObject({ fullTransactions: true, concurrency: 24 });
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_CONCURRENCY: "4",
            TYPEAGENT_MEMORY_DECISION_BATCH_SIZE: "context",
            TYPEAGENT_MEMORY_DECISION_LOOKAHEAD: "2",
            TYPEAGENT_MEMORY_DECISION_MAX_QUESTIONS: "128",
        }).decisionTopicExecution,
    ).toEqual({
        concurrency: 4,
        batchSize: "context",
        lookahead: 2,
        maxQuestions: 128,
    });
    expect(() =>
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_CONCURRENCY: "0",
        }),
    ).toThrow("concurrency");
    expect(() =>
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_BATCH_SIZE: "invalid",
        }),
    ).toThrow("batch size");
});

test("cluster validation environment preserves legacy defaults and rejects speculation", () => {
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_CLUSTER_VALIDATION: "true",
            TYPEAGENT_MEMORY_DECISION_CONCURRENCY: "24",
            TYPEAGENT_MEMORY_DECISION_BATCH_SIZE: "24",
        }).decisionTopicExecution,
    ).toMatchObject({
        clusterValidation: true,
        concurrency: 24,
        batchSize: 24,
        lookahead: 1,
    });
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_CLUSTER_VALIDATION: "false",
        }).decisionTopicExecution,
    ).not.toHaveProperty("clusterValidation");
    expect(() =>
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_CLUSTER_VALIDATION: "invalid",
        }),
    ).toThrow("TYPEAGENT_MEMORY_DECISION_CLUSTER_VALIDATION");
    expect(() =>
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_CLUSTER_VALIDATION: "true",
            TYPEAGENT_MEMORY_DECISION_FULL_TRANSACTIONS: "true",
        }),
    ).toThrow("lookahead 1");
});

test.each([
    { family: "wiki", elapsedMs: undefined },
    { family: "projects", elapsedMs: undefined },
    { family: "wiki", elapsedMs: 20 },
    { family: "projects", elapsedMs: 20 },
] as const)(
    "normal host $family target enforces its actual elapsed envelope ($elapsedMs)",
    async ({ family, elapsedMs }) => {
        const root = await mkdtemp(
            path.join(process.cwd(), ".memory-host-deadline-"),
        );
        let entered!: () => void;
        const generating = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let targetSignal: AbortSignal | undefined;
        const validate = import.meta.jest.fn();
        const service = new FileMemoryService(root, {
            ...getConfiguredMemoryViewOptions({}),
            sourceSynopses: false,
            ...(elapsedMs === undefined
                ? {}
                : {
                      informationalBudget: {
                          inputTokens: 16000,
                          outputTokens: 4000,
                          safetyTokens: 1000,
                          chatAttempts: 2,
                          reservedTokens: 160000,
                          embeddingAttempts: 128,
                          elapsedMs,
                          tokenizer: "synthetic",
                          countTokens: (text: string) => text.length,
                      },
                  }),
            indexFactory: (_id, directory) =>
                new DeadlineCorpusIndex(directory),
            viewSynthesisAdapter: {
                identity: "offline-host-deadline",
                generate: async (_input, signal) => {
                    targetSignal = signal;
                    entered();
                    return new Promise<ViewSynthesisOutput>(() => undefined);
                },
                validate,
            },
        });
        try {
            const { corpusId } = await service.createCorpus("Elapsed envelope");
            const source = await service.ingestDocument({
                corpusId,
                source: {
                    sourceId: "source",
                    sourceType: "text",
                    title: "Acquisition",
                    text: "Acquisition preserves approval boundaries.",
                },
            });
            expect((await waitForMemoryJob(service, source.jobId)).state).toBe(
                "complete",
            );
            const head = (await service.listViews(corpusId)).head;
            const retrieval = {
                query: "acquisition",
                aliases: [],
                excludedSourceIds: [],
            };
            import.meta.jest.useFakeTimers({
                doNotFake: ["nextTick", "setImmediate", "performance"],
            });
            const admitted = await service.buildViews({
                corpusId,
                expectedHead: head,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: "deadline-target",
                            kind: family === "wiki" ? "wiki" : "projectBrief",
                            selector: {
                                kind: "sources",
                                sources: [
                                    {
                                        sourceId: source.sourceId,
                                        revisionId: source.revisionId,
                                    },
                                ],
                            },
                            ...(family === "wiki"
                                ? {
                                      wiki: {
                                          ...retrieval,
                                          construction:
                                              "informational-wiki-v1" as const,
                                      },
                                  }
                                : {
                                      projectSummary: {
                                          ...retrieval,
                                          construction:
                                              "informational-project-summary-v1" as const,
                                      },
                                  }),
                        },
                    },
                ],
            });
            await generating;
            const timeoutMs = elapsedMs ?? 3_000_000;
            const beforeDeadline = elapsedMs === undefined ? 120_001 : 19;
            await import.meta.jest.advanceTimersByTimeAsync(beforeDeadline);
            expect(targetSignal?.aborted).toBe(false);
            expect((await service.getViewBuild(admitted))?.state).toBe(
                "running",
            );
            await import.meta.jest.advanceTimersByTimeAsync(
                timeoutMs - beforeDeadline - 1,
            );
            expect(targetSignal?.aborted).toBe(false);
            expect((await service.getViewBuild(admitted))?.state).toBe(
                "running",
            );
            await import.meta.jest.advanceTimersByTimeAsync(1);
            expect(targetSignal?.aborted).toBe(true);
            import.meta.jest.useRealTimers();
            let completed = await service.getViewBuild(admitted);
            for (
                let attempts = 0;
                completed?.state === "running" && attempts < 1000;
                attempts++
            ) {
                await new Promise((resolve) => setTimeout(resolve, 10));
                completed = await service.getViewBuild(admitted);
            }
            expect(completed).toMatchObject({
                state: "failed",
                results: [
                    {
                        state: "failed",
                        reason: `Evidence-first synthesis exceeded ${timeoutMs / 1000} second limit`,
                        snapshot: {
                            pipeline:
                                family === "wiki"
                                    ? "informational-wiki-v1"
                                    : "informational-project-summary-v1",
                        },
                    },
                ],
            });
            expect(validate).not.toHaveBeenCalled();
            expect((await service.listViews(corpusId)).views).toEqual([]);
        } finally {
            import.meta.jest.useRealTimers();
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    },
);

test("shared host options ignore rehearsal variables and preserve explicit YAML/environment disablement", () => {
    expect(getConfiguredMemoryViewOptions({})).toEqual({
        viewDrafts: true,
        informationalViews: true,
    });
    expect(
        getConfiguredMemoryViewOptions({
            MEMORY_WIKI_CONTEXT_TOKENS: "invalid",
            MEMORY_WIKI_OUTPUT_TOKENS: "0",
            MEMORY_WIKI_TOKENIZER: "unsupported",
        }),
    ).toEqual({ viewDrafts: true, informationalViews: true });
    expect(
        getConfiguredMemoryViewOptions({ TYPEAGENT_MEMORY_VIEW_DRAFTS: "0" })
            .viewDrafts,
    ).toBe(false);
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS: "false",
        }).informationalViews,
    ).toBe(false);
    expect(() =>
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS: "invalid",
        }),
    ).toThrow("TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS must be true or false");
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_TOPICS: "true",
        }),
    ).toEqual({
        viewDrafts: true,
        informationalViews: true,
        decisionTopics: true,
    });
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_TOPICS: "false",
        }).decisionTopics,
    ).toBe(false);
    expect(() =>
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_TOPICS: "invalid",
        }),
    ).toThrow("TYPEAGENT_MEMORY_DECISION_TOPICS must be true or false");
});

test.each([{ viewDrafts: false }, { informationalViews: false }])(
    "explicit host disablement is independent of a supplied rehearsal budget: %j",
    async (disable) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "enablement-disabled-"),
        );
        const service = new FileMemoryService(root, {
            ...disable,
            informationalBudget: {
                inputTokens: 10000,
                outputTokens: 4000,
                safetyTokens: 1000,
                chatAttempts: 2,
                reservedTokens: 160000,
                embeddingAttempts: 128,
                elapsedMs: 60000,
                tokenizer: "synthetic",
                countTokens: (text) => text.length,
            },
            indexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
        });
        try {
            expect(
                (await service.getCapabilities()).derivedViews
                    ?.informationalWiki,
            ).toBeUndefined();
            const { corpusId } = await service.createCorpus("Disabled");
            await expect(
                service.maintainViews({
                    corpusId,
                    expectedHead: null,
                    family: "wiki",
                    operation: "resume",
                }),
            ).rejects.toThrow("disabled by this host");
            if (disable.informationalViews === false) {
                const snapshot = await service.listViews(corpusId);
                expect(snapshot.wikiFamily).toBeUndefined();
                await expect(
                    service.buildViews({
                        corpusId,
                        expectedHead: snapshot.head,
                        targets: [
                            {
                                expectedVersion: 0,
                                definition: {
                                    kind: "projectBrief",
                                    viewId: "disabled-project",
                                    selector: {
                                        kind: "sources",
                                        sources: [
                                            {
                                                sourceId: "source",
                                                revisionId: "revision",
                                            },
                                        ],
                                    },
                                    projectSummary: {
                                        construction:
                                            "informational-project-summary-v1",
                                        query: "bounded",
                                        aliases: [],
                                        excludedSourceIds: [],
                                    },
                                },
                            },
                        ],
                    }),
                ).rejects.toThrow("disabled by this host");
            }
        } finally {
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    },
);

test("CLI initialization uses the same explicit whole-host disablement", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "enablement-cli-"));
    const previous = process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS;
    process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS = "false";
    try {
        const capabilities = await runMemoryViewsCli([
            "--store",
            root,
            "capabilities",
        ]);
        expect(capabilities).not.toHaveProperty("derivedViews");
    } finally {
        if (previous === undefined)
            delete process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS;
        else process.env.TYPEAGENT_MEMORY_VIEW_DRAFTS = previous;
        await rm(root, { recursive: true, force: true });
    }
});
