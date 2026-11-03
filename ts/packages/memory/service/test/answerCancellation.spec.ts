// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { currentSearchAbortSignal } from "@typeagent/knowpro";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import type { CorpusIndex } from "../src/types.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

test("foreground answers retain caller cancellation through the service/index queue", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memory-answer-cancel-"));
    const controller = new AbortController();
    const reason = new Error("Caller cancelled");
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
        entered = resolve;
    });
    class Index extends FakeSemanticCorpusIndex {
        public answer: NonNullable<CorpusIndex["answer"]> = async () => {
            const signal = currentSearchAbortSignal();
            expect(signal).toBe(controller.signal);
            entered();
            return new Promise((_resolve, reject) => {
                signal?.addEventListener("abort", () => reject(signal.reason), {
                    once: true,
                });
            });
        };
    }
    const service = new FileMemoryService(root, {
        informationalViews: false,
        maintenanceMode: "manual",
        indexFactory: (_id, directory) => new Index(directory),
    });
    try {
        const corpus = await service.createCorpus(
            "Synthetic cancellation test",
        );
        const ingested = await service.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "fixture",
                sourceType: "text",
                title: "Synthetic evidence",
                text: "Recorded evidence.",
            },
        });
        await waitForMemoryJob(service, ingested.jobId);
        const answer = service.answer(
            {
                corpusId: corpus.corpusId,
                question: "Why?",
                answerMode: "synthesized",
            },
            controller.signal,
        );
        const outcome = answer.then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
        );
        await Promise.race([
            started,
            outcome.then(() => {
                throw new Error(
                    "Foreground answer settled before entering its index.",
                );
            }),
        ]);
        controller.abort(reason);
        const result = await outcome;
        expect("error" in result && result.error).toBe(reason);
        const stopped = new AbortController();
        stopped.abort(reason);
        await expect(
            service.answer(
                { corpusId: corpus.corpusId, question: "Why?" },
                stopped.signal,
            ),
        ).rejects.toBe(reason);
    } finally {
        controller.abort(reason);
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
