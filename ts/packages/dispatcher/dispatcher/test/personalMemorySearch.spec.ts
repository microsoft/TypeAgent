// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
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

async function findIndexSchemas(directory: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await findIndexSchemas(filename)));
        } else if (entry.name === "index-schema.json") {
            files.push(filename);
        }
    }
    return files;
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

    it("rebuilds unversioned indexes and recalls the page, approved how-to, and incident after restart", async () => {
        const root = path.join(
            os.tmpdir(),
            `dispatcher-memory-${randomUUID()}`,
        );
        const previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        const extractionCalls: string[] = [];
        const factory = createStructuredIndexFactory(
            "Service X",
            () => "Service X",
            (text) => extractionCalls.push(text),
        );
        const options = {
            indexFactory: factory,
            procedureIndexFactory: factory,
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
                            "How do I restore Service X, and what did our diagnostic show?",
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
                expect(text).not.toContain("search failed");
            };
            await recall();
            const extractionsBeforeReset = extractionCalls.length;
            const schemas = await findIndexSchemas(root);
            const descriptors: unknown[] = await Promise.all(
                schemas.map(async (file) =>
                    JSON.parse(await readFile(file, "utf8")),
                ),
            );
            expect(descriptors).toEqual(
                expect.arrayContaining(
                    ["documents", "conversation-events", "procedures"].map(
                        (indexKind) => ({
                            indexSchemaVersion: 1,
                            engine: "knowpro",
                            indexKind,
                        }),
                    ),
                ),
            );
            await service.close();
            for (const schema of schemas) {
                await rm(schema);
            }
            service = new FileMemoryService(root, options);
            memory = new ConversationDurableMemory({
                service: createMemoryServiceRpcFacade(service),
                conversationId: "incident-service-x",
                runId: "follow-up",
            });
            await recall();
            expect(extractionCalls.slice(extractionsBeforeReset)).toEqual(
                expect.arrayContaining(
                    [
                        "Inspect Service X traces",
                        "Reduce concurrency",
                        "connection pool exhausted",
                        "roll back release 42",
                    ].map((text) => expect.stringContaining(text)),
                ),
            );
            expect(await memory.inspectTurn("turn-1")).toEqual(events);
            expect(
                await service.getProcedure(corpusId, procedure.procedureId, 1),
            ).toEqual(procedure);
            expect(
                await service.getSource(corpusId, job.sourceId),
            ).toMatchObject({ activeRevisionId: job.revisionId });
            expect(
                (await findIndexSchemas(root)).length,
            ).toBeGreaterThanOrEqual(3);
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
            procedureIndexFactory: createStructuredIndexFactory(
                "Zephyr",
                (text) =>
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

    it.each([
        "How do I debug a failing service X?",
        "What did that page we looked at say about debugging service X?",
    ])(
        "preserves corpus results and deduplicates real troubleshooting evidence for %s",
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
            expect(text.match(/Troubleshoot service X/g)).toHaveLength(1);
            expect(text).toContain("Service directory");
        },
    );

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
