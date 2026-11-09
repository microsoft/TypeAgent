// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
const actual = await import("../src/durableRunbookJson.js");
let writes = 0;
let entered!: () => void;
let resume!: () => void;
let held: Promise<void>;
jest.unstable_mockModule("../src/durableRunbookJson.js", () => ({
    ...actual,
    writeRunbookJson: async (
        ...args: Parameters<typeof actual.writeRunbookJson>
    ) => {
        if (++writes === 2) {
            entered();
            await held;
        }
        return actual.writeRunbookJson(...args);
    },
}));
const { MemoryBatchStore } = await import("../src/batchImport.js");

async function within<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error("Batch status waited for publication"),
                        ),
                    2000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

test("get, find, and list use durable batch metadata while progress replacement is held", async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "batch-status-concurrency-"),
    );
    writes = 0;
    held = new Promise<void>((resolve) => {
        resume = resolve;
    });
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const store = new MemoryBatchStore(root, {
        ingestDocument: async () => ({
            sourceId: "source",
            revisionId: "revision",
            jobId: "job",
            state: "complete",
            statusUri: "memory://jobs/job",
        }),
        getJob: async () => ({
            jobId: "job",
            corpusId: "corpus",
            sourceId: "source",
            revisionId: "revision",
            state: "complete",
            progress: { completed: 1, total: 1 },
            createdAt: "2026-10-28T00:00:00Z",
            updatedAt: "2026-10-28T00:00:00Z",
            warnings: [],
        }),
        cancelJob: async () => undefined,
    });
    try {
        const admission = await store.start({
            corpusId: "corpus",
            idempotencyKey: "status",
            documents: [
                {
                    source: {
                        sourceType: "text",
                        title: "Finite fixture",
                        text: "Batch fixture",
                    },
                },
            ],
        });
        await within(started);
        const [status, found, listed] = await within(
            Promise.all([
                store.get(admission.batchId),
                store.find("corpus", "status"),
                store.list("corpus"),
            ]),
        );
        expect(status.members[0].state).toBe("pending");
        expect(found).toEqual(status);
        expect(listed).toEqual([status]);
        status.members[0].reason = "Reader mutation";
        expect((await store.get(admission.batchId)).members[0].reason).not.toBe(
            "Reader mutation",
        );
        resume();
        await within(
            (async () => {
                while (
                    (await store.get(admission.batchId)).state !== "complete"
                )
                    await new Promise<void>((resolve) =>
                        setTimeout(resolve, 10),
                    );
            })(),
        );
        expect((await store.get(admission.batchId)).members[0].state).toBe(
            "complete",
        );
    } finally {
        resume();
        await store.close();
        await rm(root, { recursive: true, force: true });
    }
});
