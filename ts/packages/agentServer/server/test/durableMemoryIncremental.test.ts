// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigSync } from "@typeagent/config";
import type {
    FileMemoryService,
    IngestionJobStatus,
    MemoryKnowledgeGraph,
} from "@typeagent/memory-service";
import { createDurableMemoryService } from "../src/durableMemoryService.js";

loadConfigSync();

const memoryValidationFixtureDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../memory/service/test/data/memory-validation",
);

async function waitForTerminalJob(
    service: FileMemoryService,
    jobId: string,
): Promise<IngestionJobStatus> {
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
        const job = await service.getJob(jobId);
        if (
            job !== undefined &&
            ["complete", "partial", "failed", "cancelled"].includes(job.state)
        ) {
            return job;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Job '${jobId}' did not finish`);
}

function fullPageFixture(): string {
    return [
        "# Atlas Observatory Operations Guide",
        ...Array.from({ length: 24 }, (_, index) => {
            const section = index + 1;
            return [
                `## Procedure ${section}: Calibrate sensor bank ${section}`,
                "",
                `Technician Rowan calibrates sensor bank ${section} at the Atlas polar observatory in Reykjavik.`,
                `The procedure uses cobalt reference cell C-${section}, quartz alignment scope Q-${section}, and telemetry console T-${section}.`,
                `Before calibration, verify the isolation relay, record ambient temperature, and confirm that maintenance ticket M-${section} is approved.`,
                `If drift exceeds ${section + 2} millivolts, stop the procedure, preserve the diagnostic log, and notify the observatory operations lead.`,
                `After calibration, archive the readings under project Atlas and link them to sensor bank ${section}.`,
            ].join("\n");
        }),
    ].join("\n\n");
}

function hasSourceLinkedKnowledge(
    graph: MemoryKnowledgeGraph,
    sourceId: string,
): boolean {
    return [graph.entities, graph.topics, graph.relationships]
        .flat()
        .some((item) => item.sourceIds.includes(sourceId));
}

describe("durable memory incremental production path", () => {
    test("appends a second source and preserves both indexes after restart", async () => {
        const rootDirectory = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-live-incremental-"),
        );
        let service = createDurableMemoryService(rootDirectory);
        try {
            const corpus = await service.createCorpus(
                "Live incremental acceptance",
            );
            const sources = [
                {
                    sourceId: "zephyr-source",
                    title: "Project Zephyr",
                    markdown:
                        "# Project Zephyr\n\nProject Zephyr uses cobalt batteries for polar observatories in Reykjavik.",
                },
                {
                    sourceId: "meridian-source",
                    title: "Project Meridian",
                    markdown:
                        "# Project Meridian\n\nProject Meridian studies quartz navigation instruments in Valparaiso.",
                },
            ];
            const jobs: IngestionJobStatus[] = [];
            for (const source of sources) {
                const accepted = await service.ingestDocument({
                    corpusId: corpus.corpusId,
                    source: { ...source, sourceType: "markdown" },
                });
                const job = await waitForTerminalJob(service, accepted.jobId);
                expect(job.state).toBe("complete");
                jobs.push(job);
            }

            expect(jobs[0].trace).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ operation: "rebuild" }),
                ]),
            );
            expect(jobs[1].trace).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        operation: "append",
                        documentCount: 1,
                    }),
                ]),
            );

            await service.close();
            service = createDurableMemoryService(rootDirectory);
            for (const source of sources) {
                const result = await service.search({
                    corpusId: corpus.corpusId,
                    query: source.title,
                    sourceIds: [source.sourceId],
                });
                expect(result.matches).toEqual([
                    expect.objectContaining({ sourceId: source.sourceId }),
                ]);
            }
        } finally {
            await service.close();
            await rm(rootDirectory, { recursive: true, force: true });
        }
    }, 300_000);

    test("indexes a repeatable full-page fixture within the Luna acceptance budget", async () => {
        const rootDirectory = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-live-full-page-"),
        );
        const service = createDurableMemoryService(rootDirectory);
        try {
            const corpus = await service.createCorpus(
                "Full-page performance acceptance",
            );
            const startedAt = Date.now();
            const accepted = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: "atlas-operations-guide",
                    sourceType: "markdown",
                    title: "Atlas Observatory Operations Guide",
                    markdown: fullPageFixture(),
                },
                pipeline: {
                    mode: "full",
                    maxCharsPerChunk: 8_000,
                },
            });
            const job = await waitForTerminalJob(service, accepted.jobId);
            const elapsedMs = Date.now() - startedAt;
            const maxElapsedMs = Number(
                process.env.TYPEAGENT_MEMORY_FULL_PAGE_MAX_MS ?? 90_000,
            );

            expect(job.state).toBe("complete");
            expect(elapsedMs).toBeLessThanOrEqual(maxElapsedMs);
            expect(job.trace).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        operation: "rebuild",
                        stage: "extracting-knowledge",
                    }),
                    expect.objectContaining({
                        stage: "building-indexes",
                    }),
                ]),
            );
            await expect(
                service.search({
                    corpusId: corpus.corpusId,
                    query: "cobalt reference cell",
                    sourceIds: ["atlas-operations-guide"],
                }),
            ).resolves.toMatchObject({
                matches: [
                    expect.objectContaining({
                        sourceId: "atlas-operations-guide",
                    }),
                ],
            });
        } finally {
            await service.close();
            await rm(rootDirectory, { recursive: true, force: true });
        }
    }, 180_000);

    test("preserves semantic evidence and source-linked knowledge in full mode after restart", async () => {
        const rootDirectory = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-live-structured-rag-"),
        );
        let service = createDurableMemoryService(rootDirectory);
        try {
            const corpus = await service.createCorpus(
                "Full-mode structured RAG acceptance",
            );
            const sources = [
                {
                    sourceId: "smoke-alpha",
                    title: "Aurora-7 telemetry incident report AR-204",
                    fileName: "smoke-alpha.md",
                },
                {
                    sourceId: "smoke-beta",
                    title: "Meridian shift handoff MH-88",
                    fileName: "smoke-beta.md",
                },
            ];

            for (const source of sources) {
                const accepted = await service.ingestDocument({
                    corpusId: corpus.corpusId,
                    source: {
                        sourceId: source.sourceId,
                        sourceType: "markdown",
                        title: source.title,
                        markdown: await readFile(
                            path.join(
                                memoryValidationFixtureDirectory,
                                source.fileName,
                            ),
                            "utf8",
                        ),
                    },
                    pipeline: { mode: "full", maxCharsPerChunk: 8_000 },
                });
                const job = await waitForTerminalJob(service, accepted.jobId);
                expect(job.state).toBe("complete");
                expect(job.trace).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            stage: "extracting-knowledge",
                        }),
                        expect.objectContaining({ stage: "embedding" }),
                        expect.objectContaining({
                            stage: "building-indexes",
                        }),
                    ]),
                );
            }

            const semanticQuery =
                "relay R-17 diagnostic latch inspection interlock";
            const semanticResult = await service.search({
                corpusId: corpus.corpusId,
                query: semanticQuery,
                limit: 3,
            });
            expect(semanticResult.matches).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        sourceId: "smoke-alpha",
                        locator: expect.stringMatching(/^message:/),
                    }),
                ]),
            );

            for (const source of sources) {
                const graph = await service.getSourceKnowledge(
                    corpus.corpusId,
                    source.sourceId,
                );
                expect(hasSourceLinkedKnowledge(graph, source.sourceId)).toBe(
                    true,
                );
            }

            await service.close();
            service = createDurableMemoryService(rootDirectory);

            await expect(
                service.search({
                    corpusId: corpus.corpusId,
                    query: semanticQuery,
                    limit: 3,
                }),
            ).resolves.toMatchObject({
                matches: expect.arrayContaining([
                    expect.objectContaining({
                        sourceId: "smoke-alpha",
                        locator: expect.stringMatching(/^message:/),
                    }),
                ]),
            });
            expect(
                hasSourceLinkedKnowledge(
                    await service.getSourceKnowledge(
                        corpus.corpusId,
                        "smoke-alpha",
                    ),
                    "smoke-alpha",
                ),
            ).toBe(true);
        } finally {
            await service.close();
            await rm(rootDirectory, { recursive: true, force: true });
        }
    }, 420_000);
});
