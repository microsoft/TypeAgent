import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    createDocMemorySettings,
    docPartsFromMarkdown,
} from "@typeagent/conversation-memory";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { createKnowProCorpusIndex } from "../src/knowProCorpusIndex.js";

const markdown =
    "# Zephyr report\r\n\r\nZephyr **recovery** preserves source identity.\r\n";
const contentHash = createHash("sha256").update(markdown).digest("hex");

async function waitForJob(
    service: FileMemoryService,
    jobId: string,
): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
        const job = await service.getJob(jobId);
        if (job?.state === "complete") {
            return;
        }
        if (job?.state === "failed") {
            throw new Error(job.error);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Stubbed Markdown indexing timed out");
}

describe("Markdown source persistence with stubbed KnowPro", () => {
    let root: string;
    let service: FileMemoryService;
    let previousProvider: string | undefined;
    const extracted: string[] = [];

    function openService(): FileMemoryService {
        return new FileMemoryService(root, {
            indexFactory: (corpusId, directory) =>
                createKnowProCorpusIndex(corpusId, directory, () => {
                    const settings = createDocMemorySettings(64, undefined, {
                        completionSettings: {},
                        complete: async () => ({
                            success: true as const,
                            data: JSON.stringify({
                                searchExpressions: [
                                    {
                                        rewrittenQuery: "Zephyr",
                                        filters: [
                                            {
                                                entitySearchTerms: [
                                                    {
                                                        name: "Zephyr",
                                                        isNamePronoun: false,
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            }),
                        }),
                    });
                    settings.embeddingSize = 0;
                    const knowledge = {
                        entities: [{ name: "Zephyr", type: ["service"] }],
                        actions: [],
                        inverseActions: [],
                        topics: ["recovery"],
                    };
                    settings.conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
                        {
                            settings: { maxContextLength: 1000 },
                            extract: async (content: string) => {
                                extracted.push(content);
                                return knowledge;
                            },
                            extractWithRetry: async (content: string) => {
                                extracted.push(content);
                                return {
                                    success: true as const,
                                    data: knowledge,
                                };
                            },
                        };
                    return settings;
                }),
        });
    }

    beforeEach(async () => {
        extracted.length = 0;
        previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        root = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-markdown-persistence-"),
        );
        service = openService();
    });

    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
        if (previousProvider === undefined) {
            delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        } else {
            process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
        }
    });

    async function ingest(corpusId: string, sourceId: string): Promise<void> {
        await waitForJob(
            service,
            (
                await service.ingestDocument({
                    corpusId,
                    source: {
                        sourceId,
                        sourceType: "markdown",
                        title: `Report ${sourceId}`,
                        canonicalUri: `https://memory.test/${sourceId}.pdf`,
                        markdown,
                        tags: ["report"],
                        metadata: { producer: "pdf", artifactId: sourceId },
                        capturedAt: "2026-10-01T12:00:00.000Z",
                    },
                    pipeline: { maxCharsPerChunk: 1000 },
                })
            ).jobId,
        );
    }

    async function checkEvidence(
        corpusId: string,
        sourceIds: string[],
    ): Promise<void> {
        const result = await service.search({
            corpusId,
            query: "Zephyr",
            limit: 20,
        });
        expect(new Set(result.matches.map((match) => match.sourceId))).toEqual(
            new Set(sourceIds),
        );
        for (const evidence of result.matches) {
            expect(evidence).toMatchObject({
                corpusId,
                revisionId: contentHash,
                title: `Report ${evidence.sourceId}`,
                canonicalUri: `https://memory.test/${evidence.sourceId}.pdf`,
                sourceType: "markdown",
                capturedAt: "2026-10-01T12:00:00.000Z",
            });
            expect(evidence.locator).toMatch(/^message:\d+$/);
            expect(evidence.snippet).toContain("Zephyr");
            const expectedSnippets = docPartsFromMarkdown(
                markdown,
                1000,
                `typeagent-memory://sources/${evidence.sourceId}/revisions/${contentHash}`,
                {
                    collectLinkKnowledge: false,
                    collectStructuralKnowledge: false,
                    maxTokensPerPart: 7500,
                },
            ).map((part) => part.textChunks.join("\n"));
            expect(expectedSnippets).toContain(evidence.snippet);
            expect(evidence).not.toHaveProperty("canonicalRanges");
            expect(evidence).not.toHaveProperty("locations");
        }
        for (const sourceId of sourceIds) {
            const source = await service.getSource(corpusId, sourceId);
            expect(source).toMatchObject({
                sourceId,
                activeRevisionId: contentHash,
                metadata: { producer: "pdf", artifactId: sourceId },
                tags: ["report"],
            });
            expect(source?.revisions[0]).not.toHaveProperty("locationMap");
            expect(
                (await service.getSourceContent({ corpusId, sourceId }))
                    .content,
            ).toBe(markdown);
        }
        const answer = await service.answer({
            corpusId,
            question: "Zephyr",
            answerMode: "extractive",
        });
        expect(answer.mode).toBe("extractive");
        expect(answer.citations.length).toBeGreaterThan(0);
        expect(
            answer.citations.every((evidence) =>
                sourceIds.includes(evidence.sourceId),
            ),
        ).toBe(true);
    }

    test("uses ordinary Markdown and retains source attribution through append, restart, and reindex", async () => {
        const { corpusId } = await service.createCorpus("Markdown reports");
        await ingest(corpusId, "first");
        await ingest(corpusId, "appended");
        await checkEvidence(corpusId, ["first", "appended"]);
        expect(extracted.length).toBeGreaterThan(0);
        expect(extracted.join("\n")).toContain("Zephyr **recovery**");
        const extractionCount = extracted.length;
        await ingest(corpusId, "first");
        expect(extracted).toHaveLength(extractionCount);
        await service.close();
        service = openService();
        await checkEvidence(corpusId, ["first", "appended"]);
        await service.reindexSource(corpusId, "first");
        await checkEvidence(corpusId, ["first", "appended"]);
        await service.reindexCorpus(corpusId);
        await checkEvidence(corpusId, ["first", "appended"]);
        const manifest = JSON.parse(
            await readFile(path.join(root, corpusId, "manifest.json"), "utf8"),
        );
        expect(
            await readdir(
                path.join(root, corpusId, "index", manifest.indexGeneration),
            ),
        ).not.toContain("document-projection.json");
    });

    test.each(["search", "append"])(
        "%s rebuilds a legacy mapped generation without rewriting retained revisions",
        async (operation) => {
            const { corpusId } = await service.createCorpus(
                "Legacy Markdown reports",
            );
            await ingest(corpusId, "first");
            await service.close();
            const manifestPath = path.join(root, corpusId, "manifest.json");
            const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
            const legacyMap = {
                contentHash: "obsolete",
                entries: [{ page: 0, start: -1 }],
            };
            manifest.sources[0].revisions[0].locationMap = legacyMap;
            manifest.sources[0].revisions[0].producerExtension = {
                retained: true,
            };
            const retainedRevisions = structuredClone(
                manifest.sources[0].revisions,
            );
            await writeFile(manifestPath, JSON.stringify(manifest));
            const legacyDirectory = path.join(
                root,
                corpusId,
                "index",
                manifest.indexGeneration,
            );
            await writeFile(
                path.join(legacyDirectory, "document-projection.json"),
                "{",
            );
            const extractionCount = extracted.length;
            service = openService();
            if (operation === "append") {
                await ingest(corpusId, "appended");
            }
            const sourceIds =
                operation === "append" ? ["first", "appended"] : ["first"];
            await checkEvidence(corpusId, sourceIds);
            expect(extracted.length).toBeGreaterThan(extractionCount);
            const migrated = JSON.parse(await readFile(manifestPath, "utf8"));
            expect(migrated.indexGeneration).not.toBe(manifest.indexGeneration);
            expect(migrated.sources[0].revisions).toEqual(retainedRevisions);
            expect(await readdir(path.join(root, corpusId, "index"))).toEqual([
                migrated.indexGeneration,
            ]);
            expect(
                await readdir(
                    path.join(
                        root,
                        corpusId,
                        "index",
                        migrated.indexGeneration,
                    ),
                ),
            ).not.toContain("document-projection.json");
            await service.close();
            service = openService();
            const migratedExtractionCount = extracted.length;
            await checkEvidence(corpusId, sourceIds);
            expect(extracted).toHaveLength(migratedExtractionCount);
            await service.reindexCorpus(corpusId);
            const reindexed = JSON.parse(await readFile(manifestPath, "utf8"));
            expect(reindexed.sources[0].revisions).toEqual(retainedRevisions);
        },
    );
});
