// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigSync } from "../../packages/config/src/index.js";
import {
    createDocMemorySettings,
    docPartsFromHtml,
} from "../../packages/memory/conversation/src/index.js";
import {
    FileMemoryService,
    createKnowProCorpusIndex,
    type CorpusIndex,
    type CorpusIndexMatch,
    type IndexedDocument,
    type JobProgress,
    type MemoryKnowledgeGraph,
} from "../../packages/memory/service/src/index.js";
import { openai } from "../../packages/aiclient/src/index.js";
import { BrowserMemoryService } from "../../packages/agents/browser/src/agent/browserMemoryService.mjs";

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(fixtureDirectory, "ada-lovelace.html");
const sourceUrl = "https://en.wikipedia.org/wiki/Ada_Lovelace";
const capturedAt = "2026-09-21T00:00:00.000Z";

interface PersistedFixtureIndex {
    documents: IndexedDocument[];
    graph: MemoryKnowledgeGraph;
}

class FixtureCorpusIndex implements CorpusIndex {
    private readonly filePath: string;
    private state: PersistedFixtureIndex = {
        documents: [],
        graph: { entities: [], topics: [], relationships: [] },
    };

    public constructor(indexDirectory: string) {
        this.filePath = path.join(indexDirectory, "fixture-index.json");
    }

    public async initialize(): Promise<void> {
        try {
            this.state = JSON.parse(await readFile(this.filePath, "utf8"));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }
    }

    public async rebuild(
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void> {
        signal.throwIfAborted();
        await onProgress({
            completed: 1,
            total: 3,
            message: "Parsing fixture",
        });
        const sourceIds = documents
            .filter((document) => /Ada Lovelace/i.test(document.content))
            .map((document) => document.source.sourceId);
        this.state = {
            documents: structuredClone(documents),
            graph: {
                entities: [
                    {
                        name: "Ada Lovelace",
                        types: ["person"],
                        mentionCount: 1,
                        sourceIds,
                    },
                    {
                        name: "Charles Babbage",
                        types: ["person"],
                        mentionCount: 1,
                        sourceIds,
                    },
                    {
                        name: "Analytical Engine",
                        types: ["machine"],
                        mentionCount: 1,
                        sourceIds,
                    },
                ],
                topics: [
                    {
                        name: "computer programming",
                        mentionCount: 1,
                        sourceIds,
                    },
                    { name: "Analytical Engine", mentionCount: 1, sourceIds },
                ],
                relationships: [
                    {
                        fromEntity: "Ada Lovelace",
                        toEntity: "Charles Babbage",
                        relationshipType: "collaborated_with",
                        count: 1,
                        sourceIds,
                    },
                    {
                        fromEntity: "Ada Lovelace",
                        toEntity: "Analytical Engine",
                        relationshipType: "wrote_algorithm_for",
                        count: 1,
                        sourceIds,
                    },
                ],
            },
        };
        await onProgress({
            completed: 2,
            total: 3,
            message: "Building fixture graph",
        });
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(
            this.filePath,
            JSON.stringify(this.state, undefined, 2),
        );
        await onProgress({
            completed: 3,
            total: 3,
            message: "Fixture index persisted",
        });
    }

    public async search(
        query: string,
        limit: number,
    ): Promise<CorpusIndexMatch[]> {
        const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
        return this.state.documents
            .filter((document) =>
                terms.every((term) =>
                    document.content.toLocaleLowerCase().includes(term),
                ),
            )
            .slice(0, limit)
            .map((document) => ({
                sourceId: document.source.sourceId,
                revisionId: document.revision.revisionId,
                snippet: document.content.slice(0, 500),
                score: 1,
                locator: "fixture:ada-lovelace",
            }));
    }

    public async getKnowledgeGraph(): Promise<MemoryKnowledgeGraph> {
        return structuredClone(this.state.graph);
    }
}

async function fixtureMarkdown(): Promise<string> {
    const html = await readFile(fixturePath, "utf8");
    const parts = docPartsFromHtml(html, false, 8_000, sourceUrl);
    const markdown = parts.flatMap((part) => part.textChunks).join("\n\n");
    assert.match(markdown, /Ada Lovelace/i);
    assert.match(markdown, /Analytical Engine/i);
    return markdown;
}

async function runDeterministicAcceptance(): Promise<void> {
    const storageRoot = path.join(fixtureDirectory, "deterministic-memory");
    await rm(storageRoot, { recursive: true, force: true });
    const progress: JobProgress[] = [];
    let service = new FileMemoryService(storageRoot, {
        indexFactory: (_corpusId, indexDirectory) =>
            new FixtureCorpusIndex(indexDirectory),
    });
    await service.initialize();
    let browserMemory = new BrowserMemoryService(service);
    await browserMemory.ingest(
        {
            url: sourceUrl,
            title: "Ada Lovelace - Wikipedia",
            markdown: await fixtureMarkdown(),
            source: "acceptance-fixture",
            domain: "en.wikipedia.org",
            pageType: "article",
            capturedAt,
        },
        "full",
        { onProgress: (event) => progress.push(structuredClone(event)) },
    );
    assert(progress.length > 0, "ingestion did not report progress");
    assert.equal(progress.at(-1)?.completed, progress.at(-1)?.total);
    await service.close();

    service = new FileMemoryService(storageRoot, {
        indexFactory: (_corpusId, indexDirectory) =>
            new FixtureCorpusIndex(indexDirectory),
    });
    await service.initialize();
    browserMemory = new BrowserMemoryService(service);
    const sources = await browserMemory.listSources();
    const matches = await browserMemory.search({
        query: "Analytical Engine",
        limit: 5,
    });
    const graph = await browserMemory.getKnowledgeGraph();
    assert.equal(sources.length, 1);
    assert.equal(sources[0].canonicalUri, sourceUrl);
    assert.equal(sources[0].revisions.length, 1);
    assert.equal(sources[0].revisions[0].state, "ready");
    assert.equal(matches.length, 1);
    assert(graph.entities.some((entity) => entity.name === "Ada Lovelace"));
    assert(graph.topics.some((topic) => topic.name === "computer programming"));
    assert(graph.relationships.length > 0);
    await service.close();

    console.log(
        JSON.stringify(
            {
                mode: "deterministic-fixture",
                disclaimer:
                    "Fixture extraction validates durable plumbing; it is not Luna output.",
                progress,
                sourceCount: sources.length,
                revisionCount: sources[0].revisions.length,
                searchMatches: matches.length,
                entities: graph.entities.map((entity) => entity.name),
                topics: graph.topics.map((topic) => topic.name),
                relationshipCount: graph.relationships.length,
                restartVerified: true,
            },
            undefined,
            2,
        ),
    );
}

async function runLiveLunaAcceptance(): Promise<void> {
    loadConfigSync({ workspaceRoot: path.resolve(fixtureDirectory, "../..") });
    const storageRoot = path.join(fixtureDirectory, "luna-memory");
    await rm(storageRoot, { recursive: true, force: true });
    const service = new FileMemoryService(storageRoot, {
        indexFactory: (corpusId, indexDirectory) =>
            createKnowProCorpusIndex(corpusId, indexDirectory, () =>
                createDocMemorySettings(
                    64,
                    undefined,
                    openai.createChatModel(
                        openai.GPT_5_6_LUNA,
                        undefined,
                        undefined,
                        ["website-knowledge", "acceptance"],
                    ),
                ),
            ),
    });
    await service.initialize();
    try {
        const progress: JobProgress[] = [];
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(new Error("Luna acceptance timed out")),
            180_000,
        );
        try {
            const browserMemory = new BrowserMemoryService(service);
            const markdown = (await fixtureMarkdown()).slice(0, 12_000);
            assert.match(markdown, /Analytical Engine/i);
            await browserMemory.ingest(
                {
                    url: sourceUrl,
                    title: "Ada Lovelace - Wikipedia",
                    markdown,
                    source: "acceptance-live-luna",
                    domain: "en.wikipedia.org",
                    pageType: "article",
                    capturedAt,
                },
                "full",
                {
                    signal: controller.signal,
                    onProgress: (event) =>
                        progress.push(structuredClone(event)),
                },
            );
            const graph = await browserMemory.getKnowledgeGraph();
            assert(graph.entities.length > 0, "Luna produced no entities");
            console.log(
                JSON.stringify(
                    {
                        mode: "live-luna",
                        model: openai.GPT_5_6_LUNA,
                        progress,
                        entities: graph.entities
                            .slice(0, 20)
                            .map((entity) => entity.name),
                        topics: graph.topics
                            .slice(0, 20)
                            .map((topic) => topic.name),
                        relationshipCount: graph.relationships.length,
                    },
                    undefined,
                    2,
                ),
            );
        } finally {
            clearTimeout(timeout);
        }
    } finally {
        await service.close();
    }
}

if (process.argv.includes("--live")) {
    await runLiveLunaAcceptance();
} else {
    await runDeterministicAcceptance();
}
