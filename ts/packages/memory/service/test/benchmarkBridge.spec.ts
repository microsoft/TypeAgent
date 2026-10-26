// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    BenchmarkBridge,
    BenchmarkResponseError,
    benchmarkObject,
} from "../src/benchmarkBridge.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

describe("isolated benchmark bridge", () => {
    let directory: string;
    let service: FileMemoryService;
    let bridge: BenchmarkBridge;

    function open() {
        service = new FileMemoryService(directory, {
            viewDrafts: false,
            informationalViews: false,
            sourceSynopses: false,
            indexFactory: (_id, root) => new FakeSemanticCorpusIndex(root),
            eventIndexFactory: (_id, root) => new FakeSemanticCorpusIndex(root),
        });
        bridge = new BenchmarkBridge(service);
    }

    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), "memory-benchmark-"));
        open();
    });

    afterEach(async () => {
        await service.close();
        await rm(directory, { recursive: true, force: true });
    });

    test("rejects invalid operations and limits", async () => {
        expect(() => benchmarkObject([])).toThrow("JSON object");
        await expect(
            bridge.execute({ operation: "clearCorpus" }),
        ).rejects.toThrow("Unsupported");
        await expect(
            bridge.execute({
                operation: "search",
                corpusId: "test",
                query: "tea",
                limit: 0,
            }),
        ).rejects.toThrow("Limit");
        await expect(
            bridge.execute({ operation: "generate", prompt: "hi", schema: {} }),
        ).rejects.toThrow("No benchmark model");
    });

    test("surfaces provider filtering without parsing or scoring an answer", async () => {
        bridge = new BenchmarkBridge(service, {
            completionSettings: {},
            complete: async () => ({
                success: false,
                message: "Model response blocked by content filter",
            }),
        });
        await expect(
            bridge.execute({
                operation: "generate",
                prompt: "Synthetic question",
                schema: {
                    type: "object",
                    properties: { answer: { type: "string" } },
                    required: ["answer"],
                    additionalProperties: false,
                },
            }),
        ).rejects.toMatchObject({
            kind: "provider-blocked",
            message: "Model response blocked by content filter",
        });
    });
    test.each(["", "{", "[]", "null", '"text"'])(
        "malformed model JSON %j has a typed question failure",
        async (data) => {
            bridge = new BenchmarkBridge(service, {
                completionSettings: {},
                complete: async () => ({ success: true, data }),
            });
            const response = bridge.execute({
                operation: "generate",
                prompt: "Synthetic question",
                schema: {},
            });
            await expect(response).rejects.toBeInstanceOf(
                BenchmarkResponseError,
            );
            await expect(response).rejects.toMatchObject({
                kind: "invalid-response",
            });
        },
    );

    test("waits for a ready revision before reporting import success", async () => {
        const corpus = await service.createCorpus("benchmark");
        const imported = await bridge.execute({
            operation: "ingest",
            corpusId: corpus.corpusId,
            sourceId: "session",
            title: "Session 1; 2024-03-15",
            content: "Aster likes tea.",
            timestamp: "2024-03-15T00:00:00Z",
        });
        expect(imported).toMatchObject({
            state: "complete",
            sourceId: "session",
        });
        const source = await service.getSource(corpus.corpusId, "session");
        expect(source?.revisions[0].state).toBe("ready");
        const batch = {
            operation: "ingestBatch",
            corpusId: corpus.corpusId,
            fingerprint: "stable-batch",
            documents: [
                {
                    sourceId: "second-session",
                    title: "Second session",
                    content: "Blair likes coffee.",
                },
            ],
        };
        expect(await bridge.execute(batch)).toMatchObject({
            state: "complete",
        });
        expect(await bridge.execute(batch)).toMatchObject({
            state: "complete",
        });
        expect(await service.listSources(corpus.corpusId)).toHaveLength(2);
    });

    test("preserves event provenance, isolation and idempotency after restart", async () => {
        const first = await service.createCorpus("first");
        const second = await service.createCorpus("second");
        const request = {
            operation: "appendEvents",
            corpusId: first.corpusId,
            conversationId: "alice",
            fingerprint: "data-config-fingerprint",
            turns: ["user", "assistant"].map((role, index) => ({
                identity: `s1:${index}`,
                originalId: String(index),
                session: "s1",
                role,
                speaker: role,
                timestamp: "2024-03-15T00:00:00Z",
                originalTime: "March-15-2024",
                documentId: "alice_session1",
                content: `Tea statement ${index}`,
            })),
        };
        expect(await bridge.execute(request)).toEqual({
            appended: 2,
            replayed: 0,
        });
        const events = await service.listEvents({ corpusId: first.corpusId });
        events.items.sort((a, b) =>
            (a.turnId ?? "").localeCompare(b.turnId ?? ""),
        );
        expect(events.items.map((event) => event.sender)).toEqual([
            "user",
            "assistant",
        ]);
        expect(events.items[0].eventTime).toBe("2024-03-15T00:00:00Z");
        expect(events.items[1].metadata?.authority).toBe("evidence-only");
        await service.close();
        open();
        expect(await bridge.execute(request)).toEqual({
            appended: 0,
            replayed: 2,
        });
        const other = await bridge.execute({
            operation: "searchEvents",
            corpusId: second.corpusId,
            conversationId: "alice",
            query: "Tea",
        });
        expect(other).toMatchObject({ matches: [] });
    });
});
