// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { FileMemoryService } from "../src/fileMemoryService.js";
import {
    createMemoryServiceRpcFacade,
    waitForMemoryJob,
} from "../src/rpcFacade.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";

describe("capture-date search predicates", () => {
    let root: string;
    let service: FileMemoryService;
    let corpusId: string;

    beforeEach(async () => {
        root = path.resolve(".search-date-tests", randomUUID());
        await mkdir(root, { recursive: true });
        service = new FileMemoryService(root, {
            indexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
        });
        corpusId = (await service.createCorpus("Capture date search")).corpusId;
    });

    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
        await rm(path.dirname(root), { recursive: false }).catch(
            () => undefined,
        );
    });

    async function seed(sourceId: string, capturedAt?: string) {
        const accepted = await service.ingestDocument({
            corpusId,
            source: {
                sourceId,
                sourceType: "text",
                title: sourceId,
                text: `target ${sourceId}`,
                ...(capturedAt === undefined ? {} : { capturedAt }),
            },
        });
        expect(
            (
                await waitForMemoryJob(service, accepted.jobId, {
                    pollIntervalMs: 1,
                })
            ).state,
        ).toBe("complete");
        return accepted;
    }

    test("filters unknown and out-of-range captures before limiting evidence", async () => {
        await seed("unknown");
        await seed("old", "2025-01-01T00:00:00.000Z");
        await seed("dated-first", "2026-04-01T00:00:00.000Z");
        await seed("dated-second", "2026-05-01T00:00:00.000Z");
        await seed("dated-beyond-candidate-bound", "2026-06-01T00:00:00.000Z");
        const request = {
            corpusId,
            query: "target",
            dateFrom: "2026-01-01T00:00:00.000Z",
            dateTo: "2026-12-31T23:59:59.999Z",
        };
        const result = await createMemoryServiceRpcFacade(service).search({
            ...request,
            limit: 1,
        });
        expect(result.matches.map((match) => match.sourceId)).toEqual([
            "dated-first",
        ]);
        expect(result.warnings).toContain(
            "Date predicates filter at most 4 ranked index candidates; additional matching evidence may be omitted. Results are not complete totals.",
        );
        const two = await service.search({ ...request, limit: 2 });
        expect(two.matches.map((match) => match.sourceId)).toEqual([
            "dated-first",
            "dated-second",
        ]);
        const unknown = await service.search({
            ...request,
            sourceIds: ["unknown"],
        });
        expect(unknown.matches).toEqual([]);
        const unfiltered = await service.search({
            corpusId,
            query: "target",
            limit: 1,
        });
        expect(unfiltered.matches[0].sourceId).toBe("unknown");
        expect(unfiltered.matches[0].indexedAt).toBeDefined();
        expect(unfiltered.warnings).not.toContain(
            result.warnings[result.warnings.length - 1],
        );
    });

    test("uses inclusive capture boundaries and ISO timezone offsets, never indexing dates", async () => {
        await seed("dated", "2026-04-01T00:00:00.000Z");
        await seed("unknown");
        const result = await service.search({
            corpusId,
            query: "target",
            dateFrom: "2026-04-01T02:00:00+02:00",
            dateTo: "2026-04-01T00:00:00Z",
        });
        expect(result.matches.map((match) => match.sourceId)).toEqual([
            "dated",
        ]);
        expect(
            (
                await service.search({
                    corpusId,
                    query: "target",
                    dateFrom: "2026-04-02T00:00:00Z",
                })
            ).matches,
        ).toEqual([]);
        expect(
            (
                await service.search({
                    corpusId,
                    query: "target",
                    dateTo: "2026-03-31T23:59:59Z",
                })
            ).matches,
        ).toEqual([]);
    });

    test("rejects malformed, invalid calendar, and reversed date ranges", async () => {
        await seed("leap-date", "2024-02-29T00:00:00Z");
        for (const timestamp of [
            "not-a-date",
            "2026-01-01",
            "2026-02-30T00:00:00Z",
            "2025-02-29T00:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-01-01T25:00:00Z",
            "2026-01-01T00:00:00",
        ]) {
            await expect(
                service.search({
                    corpusId,
                    query: "target",
                    dateFrom: timestamp,
                }),
            ).rejects.toThrow("ISO timestamp");
            await expect(
                service.search({
                    corpusId,
                    query: "target",
                    dateTo: timestamp,
                }),
            ).rejects.toThrow("ISO timestamp");
        }
        await expect(
            service.search({
                corpusId,
                query: "target",
                dateFrom: "2026-04-02T00:00:00Z",
                dateTo: "2026-04-01T00:00:00Z",
            }),
        ).rejects.toThrow("must not be later");
        expect(
            (
                await service.search({
                    corpusId,
                    query: "target",
                    dateFrom: "2024-02-29T00:00:00Z",
                })
            ).matches.map((match) => match.sourceId),
        ).toEqual(["leap-date"]);
    });
});
