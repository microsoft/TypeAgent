// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfigSync } from "@typeagent/config";
import type {
    FileMemoryService,
    IngestionJobStatus,
} from "@typeagent/memory-service";
import { createDurableMemoryService } from "../src/durableMemoryService.js";

loadConfigSync();

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
});
