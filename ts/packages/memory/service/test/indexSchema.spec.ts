// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryService } from "../src/index.js";
import { classifyIndexSchema, type IndexKind } from "../src/indexSchema.js";
import { createMemoryServiceRpcFacade } from "../src/rpcFacade.js";
import { canonicalizeProcedure as canonicalize } from "../src/agentEdition.js";
import { ViewHistory } from "../src/viewHistory.js";
import type { ViewVersion } from "../src/viewTypes.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";
import type { IndexedDocument } from "../src/types.js";

const schemaFileName = "index-schema.json";
const semanticFileName = "corpus_data.json";

interface ProcedureHistoryState {
    index: Record<string, unknown>;
    views: Record<string, ViewVersion[]>;
}

function procedureHistory(root: string, corpusId: string) {
    return new ViewHistory<ProcedureHistoryState>(
        path.join(root, corpusId, "personal-how-to"),
        () => ({ index: {}, views: {} }),
    );
}

async function procedureGeneration(root: string, corpusId: string) {
    const { state } = await procedureHistory(root, corpusId).read();
    const generation = state.index.indexGeneration;
    if (typeof generation !== "string") {
        throw new Error("Saved procedure index has no generation");
    }
    return generation;
}

async function writeProcedureIndex(
    root: string,
    corpusId: string,
    index: Record<string, unknown>,
) {
    const history = procedureHistory(root, corpusId);
    const { head, state } = await history.read();
    state.index = index;
    await history.commit(
        head,
        state,
        Object.fromEntries(
            Object.entries(state.views).map(([id, versions]) => [
                `view-${encodeURIComponent(id)}.json`,
                canonicalize(versions),
            ]),
        ),
        "schema-test",
        "Set procedure index state for schema validation",
    );
}

function descriptor(indexKind: IndexKind, indexSchemaVersion = 1): string {
    return JSON.stringify({
        indexSchemaVersion,
        engine: "knowpro",
        indexKind,
    });
}

async function waitForJob(service: FileMemoryService, jobId: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
        const job = await service.getJob(jobId);
        if (job?.state === "complete" || job?.state === "failed") {
            return job;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Job '${jobId}' timed out`);
}

test.each(["documents", "conversation-events", "procedures"] as const)(
    "%s descriptors distinguish reset, current, and unsupported data",
    async (kind) => {
        const directory = await mkdtemp(
            path.join(os.tmpdir(), "memory-schema-"),
        );
        try {
            const schema = path.join(directory, schemaFileName);
            const semantic = path.join(directory, semanticFileName);
            expect(await classifyIndexSchema(directory, kind, true)).toBe(
                "reset",
            );
            await writeFile(schema, descriptor(kind, 0));
            expect(await classifyIndexSchema(directory, kind, true)).toBe(
                "reset",
            );
            await writeFile(schema, descriptor(kind));
            expect(await classifyIndexSchema(directory, kind, true)).toBe(
                "reset",
            );
            await writeFile(
                semantic,
                JSON.stringify({
                    messages: [{ text: "retained" }],
                    semanticRefs: [],
                }),
            );
            expect(await classifyIndexSchema(directory, kind, true)).toBe(
                "current",
            );
            await writeFile(semantic, "{");
            await expect(
                classifyIndexSchema(directory, kind, true),
            ).rejects.toThrow("Malformed semantic index");
            await writeFile(schema, descriptor(kind, 2));
            await expect(
                classifyIndexSchema(directory, kind, false),
            ).rejects.toThrow("Unsupported future index schema version");
            await writeFile(schema, "{");
            await expect(
                classifyIndexSchema(directory, kind, false),
            ).rejects.toThrow("Malformed index schema");
            await writeFile(schema, descriptor("documents"));
            if (kind !== "documents") {
                await expect(
                    classifyIndexSchema(directory, kind, false),
                ).rejects.toThrow("Incompatible index schema");
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    },
);

test.each(["documents", "conversation-events", "procedures"] as const)(
    "%s handles retired projection markers without changing schema safety checks",
    async (kind) => {
        const directory = await mkdtemp(
            path.join(os.tmpdir(), "memory-projection-marker-"),
        );
        try {
            const schema = path.join(directory, schemaFileName);
            await writeFile(schema, descriptor(kind));
            await writeFile(
                path.join(directory, semanticFileName),
                JSON.stringify({
                    messages: [{ text: "retained" }],
                    semanticRefs: [],
                }),
            );
            for (const marker of [
                JSON.stringify({
                    schemaVersion: 1,
                    offsetUnit: "utf16",
                    proseVersion: 1,
                }),
                "{",
            ]) {
                await writeFile(
                    path.join(directory, "document-projection.json"),
                    marker,
                );
                expect(await classifyIndexSchema(directory, kind, true)).toBe(
                    kind === "documents" ? "reset" : "current",
                );
            }
            await writeFile(schema, descriptor(kind, 2));
            await expect(
                classifyIndexSchema(directory, kind, true),
            ).rejects.toThrow("Unsupported future index schema version");
            await writeFile(schema, "{");
            await expect(
                classifyIndexSchema(directory, kind, true),
            ).rejects.toThrow("Malformed index schema");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    },
);

test("document reset replays canonical content and never copies an unmarked generation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memory-schema-doc-"));
    const counts = { rebuild: 0, append: 0 };
    const replayed: IndexedDocument[][] = [];
    const factory = (_corpusId: string, directory: string) =>
        new (class extends FakeProcedureCorpusIndex {
            public override async rebuild(documents: IndexedDocument[]) {
                counts.rebuild++;
                replayed.push(structuredClone(documents));
                await super.rebuild(documents);
            }
            public override async append(documents: IndexedDocument[]) {
                counts.append++;
                await super.append(documents);
            }
        })(directory);
    let service = new FileMemoryService(root, { indexFactory: factory });
    const ingest = async (corpusId: string, sourceId: string) => {
        const accepted = await service.ingestDocument({
            corpusId,
            source: {
                sourceId,
                sourceType: "text",
                title: sourceId,
                text: `${sourceId} retained content`,
            },
        });
        expect((await waitForJob(service, accepted.jobId)).state).toBe(
            "complete",
        );
    };
    try {
        const { corpusId } = await service.createCorpus("Documents");
        await ingest(corpusId, "alpha");
        const firstManifestPath = path.join(root, corpusId, "manifest.json");
        const manifest = JSON.parse(await readFile(firstManifestPath, "utf8"));
        const firstDirectory = path.join(
            root,
            corpusId,
            "index",
            manifest.indexGeneration,
        );
        expect(
            JSON.parse(
                await readFile(
                    path.join(firstDirectory, schemaFileName),
                    "utf8",
                ),
            ),
        ).toEqual(JSON.parse(descriptor("documents")));
        const initialRebuilds = counts.rebuild;
        await service.close();
        service = new FileMemoryService(root, { indexFactory: factory });
        expect(
            (await service.search({ corpusId, query: "alpha" })).matches,
        ).toHaveLength(1);
        expect(counts.rebuild).toBe(initialRebuilds);

        await rm(path.join(firstDirectory, schemaFileName));
        manifest.sources[0].revisions[0].pipeline.mode = "basic";
        manifest.sources[0].revisions[0].pipeline.maxCharsPerChunk = 512;
        await writeFile(firstManifestPath, JSON.stringify(manifest));
        await service.close();
        service = new FileMemoryService(root, { indexFactory: factory });
        const facade = createMemoryServiceRpcFacade(service);
        const legacyRevisionId = manifest.sources[0].activeRevisionId;
        expect(
            (await facade.getSource(corpusId, "alpha"))?.revisions[0].pipeline,
        ).toEqual({
            mode: "content",
            maxCharsPerChunk: 512,
        });
        expect(
            (await facade.listSources(corpusId))[0].revisions[0].pipeline?.mode,
        ).toBe("content");
        expect(
            (await facade.listSourcesPage({ corpusId })).items[0].revisions[0]
                .pipeline?.mode,
        ).toBe("content");
        expect(
            (
                await facade.getSourceContent({
                    corpusId,
                    sourceId: "alpha",
                    revisionId: legacyRevisionId,
                })
            ).content,
        ).toBe("alpha retained content");
        await ingest(corpusId, "beta");
        expect(counts.append).toBe(0);
        expect(
            replayed.at(-1)?.map((document) => document.pipeline.mode),
        ).toEqual(["content", "content"]);
        expect(
            (await service.getSourceContent({ corpusId, sourceId: "alpha" }))
                .content,
        ).toBe("alpha retained content");
        expect(
            (await facade.getSource(corpusId, "alpha"))?.revisions[0].pipeline
                ?.mode,
        ).toBe("content");
        const retainedManifest = JSON.parse(
            await readFile(firstManifestPath, "utf8"),
        );
        expect(retainedManifest.sources[0].revisions[0].pipeline.mode).toBe(
            "basic",
        );
        await ingest(corpusId, "gamma");
        expect(counts.append).toBe(1);
        const active = JSON.parse(await readFile(firstManifestPath, "utf8"));
        const activeDirectory = path.join(
            root,
            corpusId,
            "index",
            active.indexGeneration,
        );
        await rm(path.join(activeDirectory, semanticFileName));
        expect(
            (await service.search({ corpusId, query: "gamma" })).matches,
        ).toHaveLength(1);
        expect(counts.rebuild).toBeGreaterThan(initialRebuilds + 1);
        expect(await readdir(path.join(root, corpusId, "index"))).toHaveLength(
            1,
        );
        const recovered = JSON.parse(await readFile(firstManifestPath, "utf8"));
        const recoveredDirectory = path.join(
            root,
            corpusId,
            "index",
            recovered.indexGeneration,
        );
        await writeFile(
            path.join(recoveredDirectory, schemaFileName),
            descriptor("documents", 2),
        );
        await expect(
            service.search({ corpusId, query: "gamma" }),
        ).rejects.toThrow("Unsupported future index schema version");
        const blocked = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "delta",
                sourceType: "text",
                title: "delta",
                text: "delta",
            },
        });
        expect((await waitForJob(service, blocked.jobId)).state).toBe("failed");
        expect(await readdir(recoveredDirectory)).toContain(schemaFileName);
        expect(
            (await service.getSourceContent({ corpusId, sourceId: "gamma" }))
                .content,
        ).toBe("gamma retained content");
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("event reset and failed extraction retain ledger and suppression markers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memory-schema-event-"));
    let failNext = false;
    const factory = (_corpusId: string, directory: string) =>
        new (class extends FakeProcedureCorpusIndex {
            public override async rebuild(documents: IndexedDocument[]) {
                if (failNext) {
                    failNext = false;
                    throw new Error("Expected extraction failure");
                }
                await super.rebuild(documents);
            }
        })(directory);
    let service = new FileMemoryService(root, { eventIndexFactory: factory });
    try {
        const { corpusId } = await service.createCorpus("Events");
        const request = {
            corpusId,
            idempotencyKey: "first",
            producer: { producerId: "agent", producerType: "test" },
            eventType: "user-turn",
            sourceKind: "conversation" as const,
            conversationId: "retained-conversation",
            content: "Zephyr retained event",
        };
        await service.appendEvent(request);
        expect(
            (await service.searchEvents({ corpusId, query: "Zephyr" })).matches,
        ).toHaveLength(1);
        const indexRoot = path.join(root, corpusId, "event-search-index");
        const firstState = JSON.parse(
            await readFile(path.join(indexRoot, "state.json"), "utf8"),
        );
        await rm(path.join(indexRoot, firstState.generation, schemaFileName));
        failNext = true;
        await expect(
            service.searchEvents({ corpusId, query: "Zephyr" }),
        ).rejects.toThrow("Expected extraction failure");
        expect(await readdir(indexRoot)).toEqual([]);
        expect((await service.listEvents({ corpusId })).total).toBe(1);
        expect(
            (await service.searchEvents({ corpusId, query: "Zephyr" })).matches,
        ).toHaveLength(1);
        const recoveredState = JSON.parse(
            await readFile(path.join(indexRoot, "state.json"), "utf8"),
        );
        const recoveredDirectory = path.join(
            indexRoot,
            recoveredState.generation,
        );
        await writeFile(path.join(recoveredDirectory, schemaFileName), "{");
        await expect(
            service.searchEvents({ corpusId, query: "Zephyr" }),
        ).rejects.toThrow("Malformed index schema");
        await writeFile(
            path.join(recoveredDirectory, schemaFileName),
            descriptor("conversation-events", 2),
        );
        await service.appendEvent({ ...request, idempotencyKey: "second" });
        await expect(
            service.searchEvents({ corpusId, query: "Zephyr" }),
        ).rejects.toThrow("Unsupported future index schema version");
        expect(await readdir(recoveredDirectory)).toContain(schemaFileName);
        await writeFile(
            path.join(recoveredDirectory, schemaFileName),
            descriptor("conversation-events"),
        );
        expect(
            (await service.searchEvents({ corpusId, query: "Zephyr" })).matches,
        ).toHaveLength(2);
        await service.forgetEvents({
            corpusId,
            conversationIds: ["forgotten-conversation"],
        });
        await service.close();
        service = new FileMemoryService(root, { eventIndexFactory: factory });
        await expect(
            service.appendEvent({
                ...request,
                idempotencyKey: "forgotten",
                conversationId: "forgotten-conversation",
            }),
        ).rejects.toMatchObject({ code: "EVENT_FORGOTTEN" });
        expect((await service.listEvents({ corpusId })).total).toBe(2);
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("procedure reset preserves saved versions and rejects future generations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memory-schema-proc-"));
    const factory = (_corpusId: string, directory: string) =>
        new FakeProcedureCorpusIndex(directory);
    const service = new FileMemoryService(root, {
        procedureIndexFactory: factory,
    });
    try {
        const { corpusId } = await service.createCorpus("Procedures");
        await service.saveProcedure({
            corpusId,
            procedureId: "runbook",
            document: {
                title: "Restore Zephyr",
                steps: ["Inspect recovery logs"],
                citations: [],
            },
        });
        const firstGeneration = await procedureGeneration(root, corpusId);
        const rootIndex = path.join(
            root,
            corpusId,
            "personal-how-to",
            "search-index",
        );
        const firstDirectory = path.join(rootIndex, firstGeneration);
        await writeFile(
            path.join(firstDirectory, schemaFileName),
            descriptor("procedures", 0),
        );
        expect(
            await service.searchProcedures({ corpusId, query: "Zephyr" }),
        ).toHaveLength(1);
        const secondGeneration = await procedureGeneration(root, corpusId);
        expect(secondGeneration).not.toBe(firstGeneration);
        expect(await readdir(rootIndex)).toHaveLength(1);
        const secondDirectory = path.join(rootIndex, secondGeneration);
        await rm(path.join(secondDirectory, semanticFileName));
        expect(
            await service.searchProcedures({ corpusId, query: "Zephyr" }),
        ).toHaveLength(1);
        const thirdGeneration = await procedureGeneration(root, corpusId);
        const thirdDirectory = path.join(rootIndex, thirdGeneration);
        expect(thirdGeneration).not.toBe(secondGeneration);
        await writeFile(
            path.join(thirdDirectory, schemaFileName),
            descriptor("procedures", 2),
        );
        await expect(
            service.searchProcedures({ corpusId, query: "Zephyr" }),
        ).rejects.toThrow("Unsupported future index schema version");
        expect(
            await readFile(path.join(thirdDirectory, schemaFileName), "utf8"),
        ).toBe(descriptor("procedures", 2));
        expect(
            (await service.getProcedure(corpusId, "runbook", 1))?.document
                .title,
        ).toBe("Restore Zephyr");
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});

test.each(["documents", "conversation-events", "procedures"] as const)(
    "%s rejects malformed generation pointers before resetting derived indexes",
    async (kind) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "memory-schema-pointer-"),
        );
        const factory = (_corpusId: string, directory: string) =>
            new FakeProcedureCorpusIndex(directory);
        let service = new FileMemoryService(root, {
            indexFactory: factory,
            eventIndexFactory: factory,
            procedureIndexFactory: factory,
        });
        try {
            const { corpusId } =
                await service.createCorpus("Pointer validation");
            if (kind === "documents") {
                const job = await service.ingestDocument({
                    corpusId,
                    source: {
                        sourceId: "retained",
                        sourceType: "text",
                        title: "Retained page",
                        text: "Zephyr retained page",
                    },
                });
                expect((await waitForJob(service, job.jobId)).state).toBe(
                    "complete",
                );
            } else if (kind === "conversation-events") {
                await service.appendEvent({
                    corpusId,
                    producer: { producerId: "agent", producerType: "test" },
                    idempotencyKey: "retained",
                    sourceKind: "conversation",
                    eventType: "user-turn",
                    content: "Zephyr retained event",
                });
                await service.searchEvents({ corpusId, query: "Zephyr" });
            } else {
                await service.saveProcedure({
                    corpusId,
                    procedureId: "retained",
                    document: {
                        title: "Restore Zephyr",
                        steps: ["Inspect recovery logs"],
                        citations: [],
                    },
                });
            }
            const corpusRoot = path.join(root, corpusId);
            const fileStatePath =
                kind === "documents"
                    ? path.join(corpusRoot, "manifest.json")
                    : path.join(corpusRoot, "event-search-index", "state.json");
            const derivedRoot =
                kind === "documents"
                    ? path.join(corpusRoot, "index")
                    : kind === "conversation-events"
                      ? path.join(corpusRoot, "event-search-index")
                      : path.join(
                            corpusRoot,
                            "personal-how-to",
                            "search-index",
                        );
            const original =
                kind === "procedures"
                    ? (await procedureHistory(root, corpusId).read()).state
                          .index
                    : JSON.parse(await readFile(fileStatePath, "utf8"));
            const writeState = async (state: Record<string, unknown>) => {
                if (kind === "procedures") {
                    await writeProcedureIndex(root, corpusId, state);
                } else {
                    await writeFile(fileStatePath, JSON.stringify(state));
                }
            };
            const entries = await readdir(derivedRoot);
            const marker = path.join(corpusRoot, "canonical-marker");
            await writeFile(marker, "must survive");
            await service.close();

            for (const invalid of [
                "..\\..",
                path.resolve(root, "outside-index"),
            ]) {
                const state = {
                    ...original,
                    [kind === "conversation-events"
                        ? "generation"
                        : "indexGeneration"]: invalid,
                };
                await writeState(state);
                service = new FileMemoryService(root, {
                    indexFactory: factory,
                    eventIndexFactory: factory,
                    procedureIndexFactory: factory,
                });
                const search =
                    kind === "documents"
                        ? service.search({ corpusId, query: "Zephyr" })
                        : kind === "conversation-events"
                          ? service.searchEvents({ corpusId, query: "Zephyr" })
                          : service.searchProcedures({
                                corpusId,
                                query: "Zephyr",
                            });
                await expect(search).rejects.toThrow(
                    "Invalid index generation",
                );
                expect(await readdir(derivedRoot)).toEqual(entries);
                expect(await readFile(marker, "utf8")).toBe("must survive");
                await service.close();
            }
            await writeState(original);
            service = new FileMemoryService(root, {
                indexFactory: factory,
                eventIndexFactory: factory,
                procedureIndexFactory: factory,
            });
            if (kind === "documents") {
                expect(
                    (
                        await service.getSourceContent({
                            corpusId,
                            sourceId: "retained",
                        })
                    ).content,
                ).toBe("Zephyr retained page");
            } else if (kind === "conversation-events") {
                expect((await service.listEvents({ corpusId })).total).toBe(1);
            } else {
                expect(
                    (await service.getProcedure(corpusId, "retained", 1))
                        ?.document.title,
                ).toBe("Restore Zephyr");
            }
        } finally {
            await service.close();
            await rm(root, { recursive: true, force: true });
        }
    },
);
