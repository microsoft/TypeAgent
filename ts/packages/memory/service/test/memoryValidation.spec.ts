// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    FileMemoryService,
    createMemoryServiceRpcFacade,
} from "../src/index.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

describe("source acquisition without legacy procedure detection", () => {
    test("imports procedural source text as evidence without creating legacy state or APIs", async () => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "memory-sources-only-"),
        );
        const service = new FileMemoryService(root, {
            indexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
        });
        try {
            const corpus = await service.createCorpus("Source evidence");
            const text = await readFile(
                path.resolve(
                    "test",
                    "data",
                    "memory-validation",
                    "numbered-positive.md",
                ),
                "utf8",
            );
            const accepted = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: "runbook-source",
                    sourceType: "markdown",
                    title: "Calibration instructions",
                    markdown: text,
                    tags: ["runbook"],
                    metadata: { recordType: "runbook" },
                },
            });
            expect(
                (await waitForMemoryJob(service, accepted.jobId)).state,
            ).toBe("complete");
            expect(
                (
                    await service.getSourceContent({
                        corpusId: corpus.corpusId,
                        sourceId: accepted.sourceId,
                    })
                ).content,
            ).toBe(text);
            const facade = createMemoryServiceRpcFacade(service);
            for (const name of [
                "getPersonalHowToSettings",
                "createProcedureCandidate",
                "saveProcedure",
                "searchProcedures",
                "requestRunbookSynthesis",
            ]) {
                expect(name in service).toBe(false);
                expect(name in facade).toBe(false);
            }
            expect(
                await readdir(path.join(root, corpus.corpusId)),
            ).not.toContain("personal-how-to");
            expect(await readdir(root)).not.toContain("runbook-jobs");
        } finally {
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    });
});
