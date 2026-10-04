// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDocMemorySettings } from "@typeagent/conversation-memory";
import {
    createKnowProCorpusIndex,
    createMemoryServiceRpcFacade,
    FileMemoryService,
} from "@typeagent/memory-service";
import type {
    MemoryCorpus,
    MemorySearchResult,
    MemoryService,
    PersonalHowToService,
    ProcedureSearchMatch,
    CorpusIndexFactory,
} from "@typeagent/memory-service";
import { ConversationDurableMemory } from "../src/context/conversationDurableMemory.js";
import {
    searchPersonalMemory,
    searchReasoningConversationMemory,
} from "../src/context/personalMemorySearch.js";

const corpus = (corpusId: string, name: string): MemoryCorpus => ({
    corpusId,
    name,
    createdAt: "2026-09-29T00:00:00Z",
    updatedAt: "2026-09-29T00:00:00Z",
    status: "ready",
    documentCount: 1,
});

const result = (corpusId: string, title: string): MemorySearchResult => ({
    query: "debug service",
    matches: [
        {
            evidenceId: `e-${corpusId}`,
            corpusId,
            sourceId: `s-${corpusId}`,
            revisionId: "r1",
            title,
            canonicalUri: `https://example.com/${corpusId}/debug`,
            snippet: "Check the service logs first.",
            score: 0.8,
            sourceType: "web",
            indexedAt: "2026-09-29T00:00:00Z",
        },
    ],
    warnings: [],
    capabilitiesUsed: [],
    indexVersion: "1",
});

const noProcedures = async (): Promise<ProcedureSearchMatch[]> => [];
type SearchService = Pick<MemoryService, "listCorpora" | "search"> &
    Pick<PersonalHowToService, "searchProcedures">;

function createStructuredIndexFactory(
    queryEntity: string,
    entityFor: (text: string) => string,
    onExtract?: (text: string) => void,
): CorpusIndexFactory {
    const languageModel = {
        completionSettings: {},
        complete: async () => ({
            success: true as const,
            data: JSON.stringify({
                searchExpressions: [
                    {
                        rewrittenQuery: queryEntity,
                        filters: [
                            {
                                entitySearchTerms: [
                                    { name: queryEntity, isNamePronoun: false },
                                ],
                            },
                        ],
                    },
                ],
            }),
        }),
    };
    const knowledgeFor = (text: string) => {
        onExtract?.(text);
        return {
            entities: [{ name: entityFor(text), type: ["service"] }],
            actions: [],
            inverseActions: [],
            topics: [entityFor(text)],
        };
    };
    return (corpusId, directory) =>
        createKnowProCorpusIndex(corpusId, directory, () => {
            const settings = createDocMemorySettings(
                64,
                undefined,
                languageModel,
            );
            settings.embeddingSize = 0;
            settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
                {
                    settings: { maxContextLength: 1000 },
                    extract: async (text) => knowledgeFor(text),
                    extractWithRetry: async (text) => ({
                        success: true,
                        data: knowledgeFor(text),
                    }),
                };
            return settings;
        });
}

async function waitForIngestion(
    service: FileMemoryService,
    jobId: string,
): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
        const state = (await service.getJob(jobId))?.state;
        if (
            state !== undefined &&
            ["complete", "partial", "failed", "cancelled"].includes(state)
        ) {
            expect(state).toBe("complete");
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Ingestion ${jobId} did not finish`);
}

describe("searchPersonalMemory", () => {
    it("retrieves a saved troubleshooting page after real ingestion completes", async () => {
        const root = path.join(
            os.tmpdir(),
            `dispatcher-memory-${randomUUID()}`,
        );
        const previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        const service = new FileMemoryService(root, {
            indexFactory: createStructuredIndexFactory(
                "Service X",
                () => "Service X",
            ),
        });
        try {
            const { corpusId } = await service.createCorpus(
                "TypeAgent Browser Memory",
            );
            const job = await service.ingestDocument({
                corpusId,
                source: {
                    sourceType: "web",
                    title: "How do I debug a failing service X?",
                    canonicalUri: "https://example.com/runbooks/service-x",
                    markdown:
                        "# How do I debug a failing service X?\n\n" +
                        "1. Inspect Service X logs for startup errors.\n" +
                        "2. Check the database connection before restarting.\n",
                },
                pipeline: { mode: "content" },
            });
            await waitForIngestion(service, job.jobId);
            const text = await searchPersonalMemory(
                "How do I debug a failing service X?",
                async () => undefined,
                createMemoryServiceRpcFacade(service),
            );
            expect(text).toContain("How do I debug a failing service X?");
            expect(text).toContain("https://example.com/runbooks/service-x");
            expect(text).toContain("Inspect Service X logs");
        } finally {
            try {
                await service.close();
            } finally {
                if (previousProvider === undefined) {
                    delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
                } else {
                    process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
                }
                await rm(root, { recursive: true, force: true });
            }
        }
    });

    it("recalls PDF, web, approved how-to and substring-matched incident evidence after restart", async () => {
        const root = path.join(
            os.tmpdir(),
            `dispatcher-memory-${randomUUID()}`,
        );
        const previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        const factory = createStructuredIndexFactory(
            "Service X",
            () => "Service X",
        );
        const options = {
            indexFactory: factory,
        };
        let service = new FileMemoryService(root, options);
        try {
            const { corpusId } = await service.createCorpus(
                "TypeAgent Browser Memory",
            );
            const job = await service.ingestDocument({
                corpusId,
                source: {
                    sourceType: "web",
                    title: "Service X incident runbook",
                    canonicalUri: "https://example.com/runbooks/service-x",
                    markdown:
                        "# Service X incident runbook\n\nInspect Service X traces before restarting.",
                },
            });
            await waitForIngestion(service, job.jobId);
            const procedure = await service.saveProcedure({
                corpusId,
                procedureId: "restore-service-x",
                document: {
                    title: "Restore availability to Service X",
                    steps: ["Reduce concurrency before restarting Service X."],
                    citations: [
                        {
                            sourceId: job.sourceId,
                            revisionId: job.revisionId,
                        },
                    ],
                },
            });
            const pdfCorpus = await service.createCorpus("Saved PDFs");
            const pdfText = "Service X PDF checklist: inspect startup traces.";
            const pdfJob = await service.ingestDocument({
                corpusId: pdfCorpus.corpusId,
                source: {
                    sourceId: "pdf-runbook",
                    sourceType: "markdown",
                    title: "Service X PDF runbook",
                    canonicalUri: "https://example.com/runbooks/service-x",
                    markdown: pdfText,
                    contentHash: createHash("sha256")
                        .update(pdfText)
                        .digest("hex"),
                },
            });
            await waitForIngestion(service, pdfJob.jobId);
            let memory = new ConversationDurableMemory({
                service: createMemoryServiceRpcFacade(service),
                conversationId: "incident-service-x",
                runId: "diagnosis",
            });
            memory.recordActionResult(
                "Service X diagnostic probe: connection pool exhausted.",
                "turn-1",
                "diagnose",
                false,
            );
            memory.recordDecision(
                "For Service X, roll back release 42.",
                "turn-1",
            );
            const events = await memory.inspectTurn("turn-1");
            expect(events).toHaveLength(2);
            const recall = async () => {
                const text = await searchPersonalMemory(
                    "How do I restore Service X, and what did our diagnostic show?",
                    () =>
                        searchReasoningConversationMemory(
                            { conversationDurableMemory: memory },
                            "Service X",
                        ),
                    createMemoryServiceRpcFacade(service),
                );
                expect(text).toContain("Inspect Service X traces");
                expect(text).toContain(
                    "https://example.com/runbooks/service-x",
                );
                expect(text).toContain("Reduce concurrency");
                expect(text).toContain("connection pool exhausted");
                expect(text).toContain("roll back release 42");
                expect(text).toContain("Service X PDF runbook");
                expect(text).toContain("Service X PDF checklist");
                expect(text).toContain(
                    `source: pdf-runbook; revision: ${pdfJob.revisionId}`,
                );
                expect(text).not.toContain("Locations:");
                expect(text).not.toContain("Canonical ranges:");
                expect(text).not.toContain("search failed");
            };
            await recall();
            await service.close();
            service = new FileMemoryService(root, options);
            memory = new ConversationDurableMemory({
                service: createMemoryServiceRpcFacade(service),
                conversationId: "incident-service-x",
                runId: "follow-up",
            });
            await recall();
            expect(await memory.inspectTurn("turn-1")).toEqual(events);
            expect(
                await service.getProcedure(corpusId, procedure.procedureId, 1),
            ).toEqual(procedure);
            expect(
                await service.getSource(corpusId, job.sourceId),
            ).toMatchObject({ activeRevisionId: job.revisionId });
        } finally {
            try {
                await service.close();
            } finally {
                if (previousProvider === undefined) {
                    delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
                } else {
                    process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
                }
                await rm(root, { recursive: true, force: true });
            }
        }
    });

    it("delivers semantic procedure matches to reasoning without corpus selection", async () => {
        const root = path.join(
            os.tmpdir(),
            `dispatcher-memory-${randomUUID()}`,
        );
        const previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        const service = new FileMemoryService(root, {
            indexFactory: createStructuredIndexFactory("Zephyr", (text) =>
                text.includes("Restore availability")
                    ? "Zephyr"
                    : "Credentials",
            ),
        });
        try {
            const { corpusId } = await service.createCorpus(
                "TypeAgent Browser Memory",
            );
            await service.saveProcedure({
                corpusId,
                procedureId: "recover-zephyr",
                document: {
                    title: "Restore availability to Zephyr cluster",
                    steps: [
                        "Inspect system logs and restart unhealthy workers.",
                    ],
                    citations: [],
                },
            });
            await service.saveProcedure({
                corpusId,
                procedureId: "rotate-zephyr",
                document: {
                    title: "Rotate Zephyr credentials",
                    steps: ["Issue a new access token."],
                    citations: [],
                },
            });
            const text = await searchPersonalMemory(
                "How do I recover from a Zephyr outage?",
                async () => undefined,
                createMemoryServiceRpcFacade(service),
            );
            expect(text).toContain(
                "Saved procedure: Restore availability to Zephyr cluster",
            );
            expect(text).toContain(
                "Inspect system logs and restart unhealthy workers.",
            );
            expect(text).not.toContain("Rotate Zephyr credentials");
        } finally {
            try {
                await service.close();
            } finally {
                if (previousProvider === undefined) {
                    delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
                } else {
                    process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
                }
                await rm(root, { recursive: true, force: true });
            }
        }
    });

    it("starts conversation and corpus searches concurrently and cites saved pages", async () => {
        let finishConversation!: (value: string) => void;
        const conversation = new Promise<string>((resolve) => {
            finishConversation = resolve;
        });
        const search = jest.fn(async (request: { corpusId: string }) =>
            result(request.corpusId, `Page in ${request.corpusId}`),
        );
        const service: SearchService = {
            listCorpora: async () => [
                corpus("conversation", "typeagent-profile-conversations"),
                corpus("browser", "TypeAgent Browser Memory"),
                corpus("documents", "Imported Documents"),
            ],
            search,
            searchProcedures: noProcedures,
        };
        const pending = searchPersonalMemory(
            "debug service",
            () => conversation,
            service,
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(search).toHaveBeenCalledTimes(2);
        expect(search).toHaveBeenCalledWith({
            corpusId: "browser",
            query: "debug service",
            limit: 5,
            maxResponseChars: 8_000,
        });
        finishConversation("We discussed service X.");
        const text = await pending;
        expect(text).toContain("We discussed service X.");
        expect(text).toContain("Page in browser");
        expect(text).toContain("Page in documents");
        expect(text).toContain("https://example.com/browser/debug");
        expect(text).toContain("Check the service logs first.");
        expect(text).not.toContain("Page in conversation");
    });

    it("reports a corpus failure without discarding results from other corpora", async () => {
        const service: SearchService = {
            listCorpora: async () => [
                corpus("good", "Browser"),
                corpus("bad", "Unavailable"),
            ],
            search: async ({ corpusId }) => {
                if (corpusId === "bad") {
                    throw new Error("Index unavailable");
                }
                return result(corpusId, "Debug guide");
            },
            searchProcedures: noProcedures,
        };
        const text = await searchPersonalMemory(
            "debug service",
            async () => undefined,
            service,
        );
        expect(text).toContain("Debug guide");
        expect(text).toContain(
            "Document search failed in Unavailable: Error: Index unavailable",
        );
    });

    it("drops evidence outside the requested corpus", async () => {
        const service: SearchService = {
            listCorpora: async () => [corpus("pdf", "PDFs")],
            search: async () => ({
                ...result("pdf", "Scoped PDF"),
                matches: [
                    result("pdf", "Scoped PDF").matches[0],
                    result("other", "Out of scope").matches[0],
                ],
            }),
            searchProcedures: noProcedures,
        };
        const text = await searchPersonalMemory(
            "debug",
            async () => undefined,
            service,
        );
        expect(text).toContain("Scoped PDF");
        expect(text).not.toContain("Out of scope");
    });

    it.each([
        "How do I debug a failing service X?",
        "What did that page we looked at say about debugging service X?",
    ])(
        "preserves distinct corpus evidence sharing a troubleshooting URI for %s",
        async (question) => {
            const unrelated = result("notes", "Service directory").matches[0];
            const duplicate = result("archive", "Troubleshoot service X")
                .matches[0];
            const guide = {
                ...result("browser", "Troubleshoot service X").matches[0],
                canonicalUri: "https://example.com/runbooks/service-x",
                snippet:
                    "When service X fails at startup, inspect its logs for the database timeout before restarting it.",
                score: 0.1,
            };
            const service: SearchService = {
                listCorpora: async () => [
                    corpus("notes", "Operations notes"),
                    corpus("browser", "TypeAgent Browser Memory"),
                    corpus("archive", "Imported Documents"),
                ],
                search: async ({ corpusId, query }) => {
                    expect(query).toBe(question);
                    const evidence =
                        corpusId === "notes"
                            ? unrelated
                            : corpusId === "browser"
                              ? guide
                              : {
                                    ...duplicate,
                                    canonicalUri: guide.canonicalUri,
                                    score: 0.99,
                                };
                    return {
                        ...result(corpusId, evidence.title),
                        matches: [evidence],
                    };
                },
                searchProcedures: noProcedures,
            };
            const text = await searchPersonalMemory(
                question,
                async () =>
                    "Earlier we saved the Service X troubleshooting page.",
                service,
            );
            expect(text).toContain("Earlier we saved");
            expect(text).toContain(guide.snippet);
            expect(text).toContain(guide.canonicalUri);
            expect(text.match(/Troubleshoot service X/g)).toHaveLength(2);
            expect(text).toContain("source: s-browser; revision: r1");
            expect(text).toContain("source: s-archive; revision: r1");
            expect(text).toContain("Service directory");
        },
    );

    it("retains PDF sources, revisions and locators sharing a web URI, grouping only identical evidence", async () => {
        const uri = "https://example.com/runbooks/service-x";
        const pdf = {
            ...result("pdf", "PDF runbook").matches[0],
            canonicalUri: uri,
            sourceType: "markdown" as const,
            locator: "page 2, block 1",
            snippet: "Inspect the PDF startup checklist.",
        };
        const pdfMatches = [
            pdf,
            { ...pdf, evidenceId: "duplicate", score: 99 },
            {
                ...pdf,
                evidenceId: "second-page",
                locator: "page 3, block 7",
                snippet: "Inspect the PDF recovery checklist.",
            },
            { ...pdf, evidenceId: "new-edition", revisionId: "r2" },
            { ...pdf, evidenceId: "other-source", sourceId: "other-pdf" },
            {
                ...result("pdf", "PDF runbook").matches[0],
                canonicalUri: uri,
                sourceType: "markdown" as const,
                evidenceId: "document-level",
            },
        ];
        const service: SearchService = {
            listCorpora: async () => [
                corpus("conversation", "typeagent-profile-conversations"),
                corpus("pdf", "Saved PDFs"),
                corpus("web", "Saved Web Pages"),
            ],
            search: async ({ corpusId }) => {
                expect(corpusId).not.toBe("conversation");
                return {
                    ...result(corpusId, "Web runbook"),
                    matches:
                        corpusId === "pdf"
                            ? pdfMatches
                            : [
                                  {
                                      ...result("web", "Web runbook")
                                          .matches[0],
                                      canonicalUri: uri,
                                  },
                              ],
                };
            },
            searchProcedures: noProcedures,
        };
        const text = await searchPersonalMemory(
            "debug service",
            async () => "Our conversation recorded the rollback decision.",
            service,
        );
        expect(text).toContain(
            "Our conversation recorded the rollback decision.",
        );
        expect(text).toContain("Web runbook");
        expect(text.match(/\*\*PDF runbook\*\*/g)).toHaveLength(5);
        expect(text).toContain("location: page 2, block 1");
        expect(text).toContain("location: page 3, block 7");
        expect(text).toContain("Inspect the PDF recovery checklist.");
        expect(text).toContain("source: s-pdf; revision: r2");
        expect(text).toContain("source: other-pdf; revision: r1");
        expect(text).toContain("source: s-pdf; revision: r1)");
        expect(
            text.match(/URL: https:\/\/example.com\/runbooks\/service-x/g),
        ).toHaveLength(6);
        expect(text).not.toContain("results truncated");
    });

    it("ignores obsolete PDF geometry and retains distinct Markdown snippets", async () => {
        const evidence = {
            ...result("pdf", "Multi-page PDF").matches[0],
            sourceType: "markdown" as const,
            locator: "PDF passage",
            canonicalRanges: [
                { start: 0, end: 20 },
                { start: 40, end: 60 },
            ],
            locations: [
                {
                    start: 0,
                    end: 20,
                    page: 2,
                    blockId: "block-1",
                    bbox: [1, 2, 3, 4] as [number, number, number, number],
                },
                { start: 40, end: 60, page: 3, blockId: "block-2" },
            ],
        };
        const service: SearchService = {
            listCorpora: async () => [corpus("pdf", "PDFs")],
            search: async () => ({
                ...result("pdf", "Multi-page PDF"),
                matches: [
                    evidence,
                    {
                        ...evidence,
                        evidenceId: "reordered-duplicate",
                        canonicalRanges: [
                            ...evidence.canonicalRanges,
                        ].reverse(),
                        locations: [...evidence.locations].reverse(),
                    },
                    {
                        ...evidence,
                        evidenceId: "different-geometry",
                        locations: [
                            { ...evidence.locations[0], bbox: [5, 6, 7, 8] },
                            evidence.locations[1],
                        ],
                    },
                    {
                        ...evidence,
                        evidenceId: "different-range",
                        canonicalRanges: [{ start: 0, end: 21 }],
                    },
                    {
                        ...evidence,
                        evidenceId: "different-snippet",
                        snippet:
                            "A distinct Markdown passage without geometry.",
                    },
                ],
            }),
            searchProcedures: noProcedures,
        };
        const text = await searchPersonalMemory(
            "debug",
            async () => undefined,
            service,
        );
        expect(text.match(/\*\*Multi-page PDF\*\*/g)).toHaveLength(2);
        expect(text).toContain("A distinct Markdown passage without geometry.");
        expect(text).toContain("location: PDF passage");
        expect(text).not.toContain("Locations:");
        expect(text).not.toContain("Canonical ranges:");
        expect(text).not.toContain("bbox");
    });

    it("does not normalize distinct case-sensitive URI locations or delimiter-bearing identities", async () => {
        const evidence = result("pdf", "Exact identity").matches[0];
        const service: SearchService = {
            listCorpora: async () => [corpus("pdf", "PDFs")],
            search: async () => ({
                ...result("pdf", "Exact identity"),
                matches: [
                    {
                        ...evidence,
                        sourceId: "source:part",
                        revisionId: "revision",
                        canonicalUri: "https://example.com/A",
                    },
                    {
                        ...evidence,
                        sourceId: "source",
                        revisionId: "part:revision",
                        canonicalUri: "https://example.com/A",
                    },
                    {
                        ...evidence,
                        sourceId: "source:part",
                        revisionId: "revision",
                        canonicalUri: "https://example.com/a",
                    },
                ],
            }),
            searchProcedures: noProcedures,
        };
        const text = await searchPersonalMemory(
            "debug",
            async () => undefined,
            service,
        );
        expect(text.match(/\*\*Exact identity\*\*/g)).toHaveLength(3);
    });

    it.each([3, 8, 10])(
        "interleaves %i corpora fairly without comparing scores",
        async (count) => {
            const ids = Array.from(
                { length: count },
                (_, index) => `corpus-${index}`,
            );
            const service: SearchService = {
                listCorpora: async () => ids.map((id) => corpus(id, id)),
                search: async ({ corpusId }) => ({
                    ...result(corpusId, corpusId),
                    matches: Array.from({ length: 5 }, (_, rank) => ({
                        ...result(corpusId, `${corpusId} rank ${rank}`)
                            .matches[0],
                        locator: `passage ${rank}`,
                        score: corpusId === ids[0] ? 10_000 - rank : 0.001,
                    })),
                }),
                searchProcedures: noProcedures,
            };
            const text = await searchPersonalMemory(
                "debug",
                async () => "Conversation evidence",
                service,
            );
            const expected = Array.from(
                { length: 8 },
                (_, index) =>
                    `${ids[index % count]} rank ${Math.floor(index / count)}`,
            );
            expect(
                [...text.matchAll(/^- \*\*(.*?)\*\*/gm)].map(
                    (match) => match[1],
                ),
            ).toEqual(expected);
            expect(text).toContain("Conversation evidence");
            expect(text).toContain(
                `Document results truncated: ${count * 5 - 8} additional evidence matches omitted`,
            );
            if (count > 8) {
                expect(text).not.toContain("corpus-8 rank");
                expect(text).toContain("corpus order breaks ties");
            }
        },
    );

    it("interleaves saved procedures across corpora and reports omitted results and steps", async () => {
        const ids = Array.from({ length: 6 }, (_, index) => `corpus-${index}`);
        const service: SearchService = {
            listCorpora: async () => ids.map((id) => corpus(id, id)),
            search: async ({ corpusId }) => ({
                ...result(corpusId, corpusId),
                matches: [],
            }),
            searchProcedures: async ({
                corpusId,
            }): Promise<ProcedureSearchMatch[]> =>
                Array.from({ length: 2 }, (_, rank) => {
                    const title = `${corpusId} procedure ${rank}`;
                    return {
                        procedure: {
                            corpusId,
                            procedureId: title,
                            title,
                            state: "saved",
                            latestVersion: 1,
                            updatedAt: "2026-10-01T00:00:00Z",
                        },
                        version: {
                            corpusId,
                            procedureId: title,
                            version: 1,
                            state: "saved",
                            document: {
                                title,
                                steps: Array.from(
                                    { length: 7 },
                                    (_, step) => `Step ${step}`,
                                ),
                                citations: [],
                            },
                            canonicalJson: "{}",
                            markdown: title,
                            createdAt: "2026-10-01T00:00:00Z",
                            jsonHash: "json-hash",
                            markdownHash: "markdown-hash",
                        },
                        score: corpusId === ids[0] ? 10_000 : 0.001,
                    };
                }),
        };
        const text = await searchPersonalMemory(
            "debug",
            async () => undefined,
            service,
        );
        expect(
            [...text.matchAll(/^- \*\*Saved procedure: (.*?)\*\*/gm)].map(
                (match) => match[1],
            ),
        ).toEqual(ids.slice(0, 5).map((id) => `${id} procedure 0`));
        expect(text).toContain(
            "Procedure results truncated: 7 additional matches omitted",
        );
        expect(text).toContain(
            "[Truncated: additional procedure steps omitted.]",
        );
        expect(text).not.toContain("Step 5");
    });

    it("redistributes unused slots after deduplication and an empty corpus", async () => {
        const service: SearchService = {
            listCorpora: async () => [
                corpus("pdf", "PDFs"),
                corpus("empty", "Empty"),
                corpus("web", "Web"),
            ],
            search: async ({ corpusId }) => ({
                ...result(corpusId, corpusId),
                matches:
                    corpusId === "empty"
                        ? []
                        : corpusId === "pdf"
                          ? Array.from(
                                { length: 5 },
                                () => result("pdf", "One PDF").matches[0],
                            )
                          : Array.from({ length: 5 }, (_, rank) => ({
                                ...result("web", `Web ${rank}`).matches[0],
                                locator: `passage ${rank}`,
                            })),
            }),
            searchProcedures: noProcedures,
        };
        const text = await searchPersonalMemory(
            "debug",
            async () => undefined,
            service,
        );
        expect(
            [...text.matchAll(/^- \*\*(.*?)\*\*/gm)].map((match) => match[1]),
        ).toEqual(["One PDF", "Web 0", "Web 1", "Web 2", "Web 3", "Web 4"]);
        expect(text).not.toContain("results truncated");
    });

    it("keeps PDF and web results alongside conversation, document and procedure failures and service truncation warnings", async () => {
        const service: SearchService = {
            listCorpora: async () => [
                corpus("pdf", "PDFs"),
                corpus("web", "Web"),
                corpus("bad", "Unavailable"),
            ],
            search: async ({ corpusId }) => {
                if (corpusId === "bad") {
                    throw new Error("Index unavailable");
                }
                return {
                    ...result(corpusId, `${corpusId} evidence`),
                    warnings:
                        corpusId === "pdf"
                            ? ["Response truncated at service character limit"]
                            : [],
                };
            },
            searchProcedures: async ({ corpusId }) => {
                if (corpusId === "web") {
                    throw new Error("Procedure index unavailable");
                }
                return [];
            },
        };
        const text = await searchPersonalMemory(
            "debug",
            async () => {
                throw new Error("Conversation unavailable");
            },
            service,
        );
        expect(text).toContain("pdf evidence");
        expect(text).toContain("web evidence");
        expect(text).toContain(
            "Conversation memory search failed: Error: Conversation unavailable",
        );
        expect(text).toContain(
            "Document search failed in Unavailable: Error: Index unavailable",
        );
        expect(text).toContain(
            "Procedure search failed in Web: Error: Procedure index unavailable",
        );
        expect(text).toContain(
            "Document search warning in PDFs: Response truncated at service character limit",
        );
    });

    it("bounds oversized evidence, conversation text and failure diagnostics with explicit notices", async () => {
        const service: SearchService = {
            listCorpora: async () =>
                Array.from({ length: 20 }, (_, index) =>
                    corpus(`corpus-${index}`, `Corpus ${index}`),
                ),
            search: async ({ corpusId }) => {
                if (corpusId === "corpus-19") {
                    throw new Error("Failed " + "x".repeat(30_000));
                }
                return {
                    ...result(corpusId, `Evidence ${corpusId}`),
                    matches: Array.from({ length: 5 }, (_, index) => ({
                        ...result(corpusId, `Evidence ${corpusId}`).matches[0],
                        locator: `page ${index + 1}`,
                        snippet: "y".repeat(30_000),
                    })),
                };
            },
            searchProcedures: noProcedures,
        };
        const text = await searchPersonalMemory(
            "debug",
            async () => "z".repeat(30_000),
            service,
        );
        expect(text.length).toBeLessThanOrEqual(24_000);
        expect(text).toContain("Evidence corpus-0");
        expect(text).toContain("Evidence corpus-7");
        expect(text).toContain(
            "Document search failed in Corpus 19: Error: Failed",
        );
        expect(text).toContain(
            "Document results truncated: 87 additional evidence matches omitted",
        );
        expect(
            text.match(/\[Truncated: character limit reached\.\]/g)!.length,
        ).toBeGreaterThanOrEqual(10);
    });

    it("still searches documents when conversation recall fails", async () => {
        const service: SearchService = {
            listCorpora: async () => [corpus("browser", "Browser")],
            search: async () => result("browser", "Relevant page"),
            searchProcedures: noProcedures,
        };
        const text = await searchPersonalMemory(
            "debug service",
            async () => {
                throw new Error("Conversation index unavailable");
            },
            service,
        );
        expect(text).toContain("Relevant page");
        expect(text).toContain("Conversation memory search failed");
    });

    it("does not claim to have searched documents when the host has no service", async () => {
        const text = await searchPersonalMemory(
            "debug service",
            async () => undefined,
        );
        expect(text).toContain("Saved document search is unavailable");
        expect(text).not.toContain(
            "No matching conversation or saved documents",
        );
    });
});
