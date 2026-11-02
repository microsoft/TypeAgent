// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IngestionJobStatus } from "../src/types.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
let jobsDirectory = "";
let active = 0;
let maximum = 0;
let fault: "denied" | "corrupt" | undefined;
const pending = new Set<Promise<unknown>>();
jest.unstable_mockModule("node:fs/promises", () => ({
    ...fs,
    readFile: (...args: Parameters<typeof fs.readFile>) => {
        if (path.dirname(String(args[0])) !== jobsDirectory)
            return fs.readFile(...args);
        const operation = (async () => {
            active++;
            maximum = Math.max(maximum, active);
            try {
                if (active > 32)
                    throw Object.assign(
                        new Error("Fixture descriptor exhaustion"),
                        { code: "EMFILE" },
                    );
                await new Promise<void>((resolve) => setImmediate(resolve));
                if (String(args[0]).endsWith("job-254.json")) {
                    if (fault === "denied")
                        throw Object.assign(
                            new Error("Fixture access denied"),
                            { code: "EACCES" },
                        );
                    if (fault === "corrupt") return "{invalid";
                }
                return await fs.readFile(...args);
            } finally {
                active--;
            }
        })();
        pending.add(operation);
        void operation.then(
            () => pending.delete(operation),
            () => pending.delete(operation),
        );
        return operation;
    },
}));
const { FileMemoryService } = await import("../src/fileMemoryService.js");

test.each([undefined, "denied", "corrupt"] as const)(
    "job reads share a bounded pool and preserve pagination and %s failures",
    async (scenario) => {
        active = 0;
        maximum = 0;
        fault = undefined;
        const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "memory-job-reads-"),
        );
        const service = new FileMemoryService(root, {
            viewDrafts: false,
            informationalViews: false,
            indexFactory: (_corpusId, directory) =>
                new FakeSemanticCorpusIndex(directory),
        });
        try {
            const corpus = await service.createCorpus("Job read fixture");
            jobsDirectory = path.join(root, "jobs");
            await fs.mkdir(jobsDirectory, { recursive: true });
            for (let index = 0; index < 256; index++) {
                const id = "job-" + String(index).padStart(3, "0");
                const job: IngestionJobStatus = {
                    jobId: id,
                    corpusId:
                        index % 2 === 0 ? corpus.corpusId : "other-corpus",
                    sourceId: "source-" + (index % 3),
                    revisionId: "revision",
                    state:
                        index % 4 === 0
                            ? "accepted"
                            : index % 4 === 1
                              ? "failed"
                              : "complete",
                    progress: {
                        completed: 0,
                        total: 1,
                        message: "Retained fixture",
                    },
                    createdAt: new Date(
                        Date.UTC(2026, 0, 1) + index * 1000,
                    ).toISOString(),
                    updatedAt: "2026-01-01T00:00:00.000Z",
                    warnings: [],
                };
                await fs.writeFile(
                    path.join(jobsDirectory, id + ".json"),
                    JSON.stringify(job),
                );
            }
            fault = scenario;
            if (scenario) {
                await expect(
                    service.getCorpus(corpus.corpusId),
                ).rejects.toThrow(
                    scenario === "denied" ? "Fixture access denied" : /JSON/,
                );
            } else {
                const [status, first, accepted] = await Promise.all([
                    service.getCorpus(corpus.corpusId),
                    service.listJobs({
                        corpusId: corpus.corpusId,
                        pageSize: 20,
                    }),
                    service.listJobs({
                        corpusId: corpus.corpusId,
                        states: ["accepted"],
                        pageSize: 10,
                    }),
                ]);
                expect(status?.activeJobCount).toBe(64);
                expect(first.total).toBe(128);
                expect(first.items).toHaveLength(20);
                expect(first.items[0].jobId).toBe("job-254");
                expect(accepted.total).toBe(64);
                expect(
                    accepted.items.every((job) => job.state === "accepted"),
                ).toBe(true);
                if (first.nextContinuationToken === undefined) {
                    throw new Error("Fixture did not produce a second page");
                }
                const next = await service.listJobs({
                    corpusId: corpus.corpusId,
                    pageSize: 20,
                    continuationToken: first.nextContinuationToken,
                });
                expect(next.items[0].jobId).toBe("job-214");
                expect(await service.getJob("job-254")).toMatchObject({
                    state: "complete",
                });
            }
            expect(maximum).toBeLessThanOrEqual(16);
        } finally {
            while (pending.size) {
                await Promise.allSettled([...pending]);
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
            jobsDirectory = "";
            fault = undefined;
            await service.close();
            await fs.rm(root, { recursive: true, force: true });
        }
    },
);
