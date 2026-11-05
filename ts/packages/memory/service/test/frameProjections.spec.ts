// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { dataFrame as df, type TemporalQueryContext } from "@typeagent/knowpro";
import { FileMemoryService } from "../src/fileMemoryService.js";
import {
    descriptorFrameRows,
    jsonFrameSpans,
    sourceFrameRows,
    viewFrameRows,
} from "../src/frameProjection.js";
import {
    framePredicateTypeScript,
    validateFrameSourceProviders,
    type FrameSourceProvider,
} from "../src/frameTypes.js";
import type { ViewVersion } from "../src/viewTypes.js";
import type { MemorySource } from "../src/types.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { sqlite } from "@typeagent/memory-storage";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";

const descriptor: df.FrameProjectionDescriptor = {
    schema: {
        id: "measurements.performance",
        revision: 1,
        description: "Retained producer measurements",
        fields: {
            component: { type: "string" },
            duration: { type: "number", unit: "ms", optional: true },
        },
    },
    rowsPointer: "/items",
    itemKeyPointer: "/id",
    fields: { component: "/component", duration: "/duration" },
};
const provider: FrameSourceProvider = {
    providerId: "measurements",
    version: "1",
    sourceTypes: ["text"],
    projections: [descriptor],
    authorize: async () => true,
};
test("frame translation schema admits only exact declared field IDs", () => {
    const validator = createTypeScriptJsonValidator<df.FramePredicate>(
        framePredicateTypeScript(descriptor.schema),
        "FramePredicate",
    );
    expect(
        validator.validate({
            and: [{ fieldId: "duration", op: "gte", value: 30, unit: "ms" }],
        }).success,
    ).toBe(true);
    expect(
        validator.validate({
            and: [
                {
                    fieldId: "measurements.performance.duration",
                    op: "gte",
                    value: 30,
                    unit: "ms",
                },
            ],
        }).success,
    ).toBe(false);
    const dotted = createTypeScriptJsonValidator<df.FramePredicate>(
        framePredicateTypeScript({
            ...descriptor.schema,
            fields: { "value.city": { type: "string" } },
        }),
        "FramePredicate",
    );
    expect(
        dotted.validate({
            and: [{ fieldId: "value.city", op: "eq", value: "Dublin" }],
        }).success,
    ).toBe(true);
});
class ScopedIndex extends FakeSemanticCorpusIndex {
    public override async search(
        query: string,
        limit: number,
        tags?: string[],
        _temporal?: TemporalQueryContext,
        sourceIds?: ReadonlySet<string>,
    ) {
        const matches = await super.search(query, this.documents.length, tags);
        return matches
            .filter(
                (match) =>
                    sourceIds === undefined || sourceIds.has(match.sourceId),
            )
            .slice(0, limit);
    }
}
describe("source dataframe lifecycle", () => {
    let root: string;
    let service: FileMemoryService;
    let corpusId: string;
    let denied: Set<string>;
    const options = () => ({
        frameProjections: true,
        informationalViews: false,
        sourceSynopses: false,
        discoveryPolicy: "off" as const,
        sourceFrameProviders: [
            {
                ...provider,
                authorize: async (source: MemorySource) =>
                    !denied.has(source.sourceId),
            },
        ],
        indexFactory: (_id: string, directory: string) =>
            new ScopedIndex(directory),
    });
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "memory-frames-"));
        denied = new Set();
        service = new FileMemoryService(root, options());
        corpusId = (await service.createCorpus("Frame fixtures")).corpusId;
    });
    afterEach(async () => {
        try {
            await service.close();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    async function ingest(
        sourceId: string,
        items: unknown[],
        title = sourceId,
        metadata: MemorySource["metadata"] = {},
    ) {
        const job = await service.ingestDocument({
            corpusId,
            source: {
                sourceId,
                sourceType: "text",
                title,
                text: JSON.stringify({ label: "needle", items }),
                metadata: { frameProviderId: provider.providerId, ...metadata },
            },
            pipeline: { updatePolicy: "replaceActiveRevision" },
        });
        const result = await waitForMemoryJob(service, job.jobId);
        expect(result.state).toBe("complete");
    }
    const predicate: df.FramePredicate = {
        and: [
            { fieldId: "component", op: "eq", value: "api" },
            { fieldId: "duration", op: "gte", value: 30, unit: "ms" },
        ],
    };
    const query = () =>
        service.queryFrame({
            corpusId,
            schemaId: descriptor.schema.id,
            schemaRevision: 1,
            predicate,
        });
    test("same-item filters, exact JSON evidence, current replacement and restart/backfill", async () => {
        await ingest("cross-item", [
            { id: "one", component: "api", duration: 10 },
            { id: "two", component: "batch", duration: 40 },
        ]);
        await ingest("match", [
            { id: "three", component: "api", duration: 50 },
        ]);
        const first = await query();
        expect(first.rows.map((r) => [r.ownerKey, r.itemKey])).toEqual([
            ["source:match", "three"],
        ]);
        expect(first.rows[0].evidence[0].excerpt).toBe(
            '{"id":"three","component":"api","duration":50}',
        );
        expect(first.rows[0].granularity).toBe("record");
        expect(first.rows[0].origin).toBe("source");
        expect(first.coverage.failed).toBe(0);
        await ingest("match", [{ id: "four", component: "api", duration: 20 }]);
        expect((await query()).rows).toEqual([]);
        await service.close();
        service = new FileMemoryService(root, options());
        expect((await query()).rows).toEqual([]);
        await ingest("match", [{ id: "five", component: "api", duration: 40 }]);
        const preview = await service.previewForgetSource(corpusId, "match");
        await service.forgetSource({
            corpusId,
            sourceId: "match",
            confirmationToken: preview.confirmationToken,
        });
        expect((await query()).rows).toEqual([]);
        expect(
            (await service.getFrameProjectionStatus(corpusId)).owners.map(
                (o) => o.ownerKey,
            ),
        ).not.toContain("source:match");
        await service.clearCorpus(corpusId);
        expect(
            (await service.getFrameProjectionStatus(corpusId)).owners,
        ).toEqual([]);
    });
    test("hard filtering happens before semantic ranking and limits", async () => {
        for (let i = 0; i < 6; i++)
            await ingest(`unmatched-${i}`, [
                { id: "one", component: "api", duration: 10 },
            ]);
        await ingest("last-match", [
            { id: "one", component: "api", duration: 50 },
        ]);
        const result = await service.search({
            corpusId,
            query: "needle",
            limit: 1,
            retrievalPolicy: "sourcesOnly",
            frameFilter: {
                schemaId: descriptor.schema.id,
                schemaRevision: 1,
                predicate,
            },
        });
        expect(result.matches.map((m) => m.sourceId)).toEqual(["last-match"]);
        const empty = await service.search({
            corpusId,
            query: "needle",
            frameFilter: {
                schemaId: descriptor.schema.id,
                schemaRevision: 1,
                predicate: {
                    and: [{ fieldId: "duration", op: "gt", value: 100 }],
                },
            },
        });
        expect(empty.matches).toEqual([]);
    });
    test("provider rows inherit repository, commit and environment scope from supporting sources", async () => {
        await ingest(
            "scoped",
            [{ id: "sample", component: "api", duration: 40 }],
            "Scoped sample",
            {
                repository: "example",
                commit: "commit-one",
                environment: "test",
            },
        );
        const request = {
            corpusId,
            schemaId: descriptor.schema.id,
            schemaRevision: 1,
            predicate,
            repository: "example",
            commit: "commit-one",
            environment: "test",
        };
        expect((await service.queryFrame(request)).rows).toHaveLength(1);
        for (const field of ["repository", "commit", "environment"])
            expect(
                (await service.queryFrame({ ...request, [field]: "other" }))
                    .rows,
            ).toEqual([]);
    });
    test("provider revocation removes fields and facts without removing ordinary sources", async () => {
        await ingest("private", [
            { id: "one", component: "api", duration: 50 },
        ]);
        expect((await query()).rows).toHaveLength(1);
        denied.add("private");
        const schemas = await service.listFrameSchemas(corpusId);
        expect(schemas.some((s) => s.id === descriptor.schema.id)).toBe(false);
        await expect(query()).rejects.toThrow("Unknown frame schema");
        expect(await service.listSources(corpusId)).toHaveLength(1);
        const source = (await service.listSources(corpusId))[0];
        source.revisions[0].authoredAt = "2026-11-02T10:00:00Z";
        const header = sourceFrameRows(source)[0];
        expect(header.values.authoredInstant).toEqual({
            kind: "instant",
            raw: "2026-11-02T10:00:00Z",
        });
        expect(header.values.authoredAt).toBeUndefined();
        denied.clear();
        expect((await query()).rows).toHaveLength(1);
    });
    test("unknown imported outcomes do not satisfy ordinary comparisons", async () => {
        await ingest("reported-events", [], "Reported events", {
            agentSession: {
                sessionId: "session",
                events: [
                    { id: "missing", kind: "message", outcome: "unknown" },
                    { id: "success", kind: "verification", outcome: "success" },
                ],
            },
        });
        const result = await service.queryFrame({
            corpusId,
            schemaId: "source.event",
            schemaRevision: 1,
            predicate: {
                and: [{ fieldId: "outcome", op: "neq", value: "failure" }],
            },
        });
        expect(result.rows.map((item) => item.itemKey)).toEqual(["success"]);
    });
    test("definition revisions add fields from retained payload without re-ingestion", async () => {
        await ingest("existing", [
            { id: "one", component: "api", duration: 50, passed: true },
        ]);
        const revision = (await query()).rows[0].ownerRevisionId;
        await service.close();
        const extended = {
            ...descriptor,
            schema: {
                ...descriptor.schema,
                revision: 2,
                fields: {
                    ...descriptor.schema.fields,
                    passed: { type: "boolean" as const },
                },
            },
            fields: { ...descriptor.fields, passed: "/passed" },
        };
        service = new FileMemoryService(root, {
            ...options(),
            sourceFrameProviders: [
                { ...provider, version: "2", projections: [extended] },
            ],
        });
        const result = await service.queryFrame({
            corpusId,
            schemaId: descriptor.schema.id,
            schemaRevision: 2,
            predicate: { and: [{ fieldId: "passed", op: "eq", value: true }] },
        });
        expect(result.rows[0].ownerRevisionId).toBe(revision);
        expect(result.rows[0].values.passed).toBe(true);
        await expect(query()).rejects.toThrow("Unknown frame schema revision");
    });
    test("paging is snapshot-bound and invalid requests do not degrade to unfiltered search", async () => {
        await ingest("paged", [
            { id: "a", component: "api", duration: 40 },
            { id: "b", component: "api", duration: 50 },
        ]);
        const first = await service.queryFrame({
            corpusId,
            schemaId: descriptor.schema.id,
            schemaRevision: 1,
            predicate,
            limit: 1,
        });
        const second = await service.queryFrame({
            corpusId,
            schemaId: descriptor.schema.id,
            schemaRevision: 1,
            predicate,
            limit: 1,
            cursor: first.nextCursor,
        });
        expect([...first.rows, ...second.rows].map((r) => r.itemKey)).toEqual([
            "a",
            "b",
        ]);
        await ingest("paged", []);
        await expect(
            service.queryFrame({
                corpusId,
                schemaId: descriptor.schema.id,
                schemaRevision: 1,
                predicate,
                cursor: first.nextCursor,
            }),
        ).rejects.toThrow("stale");
        await expect(
            service.queryFrame({
                corpusId,
                schemaId: descriptor.schema.id,
                schemaRevision: 1,
                predicate: {
                    and: [{ fieldId: "duration", op: "gte", value: "40" }],
                },
            }),
        ).rejects.toThrow("Invalid number");
        await expect(
            service.queryFrame({
                corpusId,
                schemaId: descriptor.schema.id,
                schemaRevision: 1,
                predicate: {
                    and: [
                        {
                            fieldId: "duration",
                            op: "gte",
                            value: 40,
                            unit: "s",
                        },
                    ],
                },
            }),
        ).rejects.toThrow("Incompatible");
    });
    test("schema-aware language translation is cached and hard filters drain every page", async () => {
        await service.close();
        let translations = 0;
        service = new FileMemoryService(root, {
            ...options(),
            frameQueryTranslator: {
                identity: "offline-frames-v1",
                translate: async (schema) => {
                    translations++;
                    expect(schema.fields.duration.unit).toBe("ms");
                    return predicate;
                },
            },
        });
        await ingest(
            "bulk",
            Array.from({ length: 1000 }, (_, index) => ({
                id: String(index),
                component: "api",
                duration: 40,
            })),
        );
        await ingest("z-last", [
            { id: "last", component: "api", duration: 50 },
        ]);
        const request = {
            corpusId,
            query: "needle",
            limit: 2,
            retrievalPolicy: "sourcesOnly" as const,
            frameFilter: {
                schemaId: descriptor.schema.id,
                schemaRevision: 1,
                query: "API duration at least 30 ms",
            },
        };
        expect(
            (await service.search(request)).matches.map((m) => m.sourceId),
        ).toEqual(["bulk", "z-last"]);
        expect((await service.search(request)).matches).toHaveLength(2);
        expect(translations).toBe(1);
    });
    test("provider authorization is rechecked after awaited language work", async () => {
        await service.close();
        let enter!: () => void, release!: () => void;
        const entered = new Promise<void>((resolve) => {
            enter = resolve;
        });
        const resumed = new Promise<void>((resolve) => {
            release = resolve;
        });
        service = new FileMemoryService(root, {
            ...options(),
            frameQueryTranslator: {
                identity: "offline-delayed-v1",
                translate: async () => {
                    enter();
                    await resumed;
                    return predicate;
                },
            },
        });
        await ingest("revoked", [
            { id: "one", component: "api", duration: 50 },
        ]);
        const pending = service.queryFrame({
            corpusId,
            schemaId: descriptor.schema.id,
            schemaRevision: 1,
            query: "API duration at least 30 ms",
        });
        await entered;
        denied.add("revoked");
        release();
        await expect(pending).rejects.toThrow("authorization changed");
        expect(
            (await service.listFrameSchemas(corpusId)).some(
                (s) => s.id === descriptor.schema.id,
            ),
        ).toBe(false);
    });
    test("failed frame receipts are explicit, recoverable and do not disable ordinary semantic search", async () => {
        await ingest("recoverable", [
            { id: "one", component: "api", duration: 40 },
        ]);
        await service.close();
        let store: sqlite.SqliteFrameProjectionStore | undefined;
        let fail = false;
        service = new FileMemoryService(root, {
            ...options(),
            frameStoreFactory: (filename) => {
                store = new sqlite.SqliteFrameProjectionStore(
                    filename,
                    (point) => {
                        if (point === "receipt" && fail)
                            throw new Error("injected frame receipt failure");
                    },
                );
                return store;
            },
        });
        const ready = await service.getFrameProjectionStatus(corpusId);
        const receipt = ready.owners.find(
            (owner) => owner.ownerKey === "source:recoverable",
        )!;
        store!.stage({
            ...receipt,
            dependencies: [
                { sourceId: "recoverable", revisionId: receipt.revisionId },
            ],
            rows: [],
        });
        fail = true;
        const failed = await service.getFrameProjectionStatus(corpusId);
        expect(failed.coverage.failed).toBe(1);
        expect(failed.owners[0].error).toContain(
            "injected frame receipt failure",
        );
        await expect(query()).rejects.toThrow("not ready");
        expect(
            (
                await service.search({
                    corpusId,
                    query: "needle",
                    retrievalPolicy: "sourcesOnly",
                })
            ).matches,
        ).toHaveLength(1);
        fail = false;
        expect((await query()).rows).toHaveLength(1);
        expect(
            (await service.getFrameProjectionStatus(corpusId)).coverage.failed,
        ).toBe(0);
    });
    test("forget during preparation cannot resurrect persistent owner facts", async () => {
        await ingest("forgotten", [
            { id: "one", component: "api", duration: 40 },
        ]);
        await service.close();
        let store: sqlite.SqliteFrameProjectionStore | undefined;
        let pause = false;
        let enter!: () => void, release!: () => void;
        const entered = new Promise<void>((resolve) => {
            enter = resolve;
        });
        const resumed = new Promise<void>((resolve) => {
            release = resolve;
        });
        service = new FileMemoryService(root, {
            ...options(),
            frameStoreFactory: (filename) => {
                store = new sqlite.SqliteFrameProjectionStore(filename);
                return store;
            },
            sourceFrameProviders: [
                {
                    ...provider,
                    authorize: async () => {
                        if (pause) {
                            enter();
                            await resumed;
                        }
                        return true;
                    },
                },
            ],
        });
        await service.getFrameProjectionStatus(corpusId);
        const preview = await service.previewForgetSource(
            corpusId,
            "forgotten",
        );
        pause = true;
        const pending = query();
        const rejected = expect(pending).rejects.toThrow(
            /changed|forget|remov|privacy|read/i,
        );
        await entered;
        const forgotten = service.forgetSource({
            corpusId,
            sourceId: "forgotten",
            confirmationToken: preview.confirmationToken,
        });
        release();
        await forgotten;
        await rejected;
        expect(
            store!
                .receipts()
                .some((owner) => owner.ownerKey === "source:forgotten"),
        ).toBe(false);
        expect(
            store!
                .schemas()
                .some((schema) => schema.id === descriptor.schema.id),
        ).toBe(false);
    });
});

test("declarative selectors preserve escapes, missing values and exact retained spans", () => {
    const text =
        '{"items":[{"id":"one","a/b":{"~key":true},"component":"api"}, {"id":"two","component":"batch","duration":50}]}';
    const spans = jsonFrameSpans(text);
    const span = spans.get("/items/0/a~1b/~0key")!;
    expect(text.slice(span.start, span.end)).toBe("true");
    expect(df.framePointer(JSON.parse(text), "/items/0/a~1b/~0key")).toBe(true);
    const rows = descriptorFrameRows(
        JSON.parse(text),
        descriptor,
        () => ({ support: [], opposition: [] }),
        true,
    );
    expect(rows[0].valueStates?.duration).toBe("unavailable");
    expect(rows[0].values.duration).toBeUndefined();
    expect(() => df.framePointer({}, "/a/__proto__")).toThrow("Unsafe");
    expect(() => validateFrameSourceProviders([provider, provider])).toThrow(
        "duplicate",
    );
    expect(() =>
        validateFrameSourceProviders([
            {
                ...provider,
                projections: [
                    {
                        ...descriptor,
                        schema: { ...descriptor.schema, id: "source.metrics" },
                    },
                ],
            },
        ]),
    ).toThrow("namespace");
});

test("approved question fields have stable definition revisions and selected-item identity", () => {
    const view = JSON.parse(
        readFileSync(
            new URL(
                "../../../client/test/schemaViewFixture.json",
                import.meta.url,
            ),
            "utf8",
        ),
    ) as ViewVersion;
    const first = viewFrameRows(view, true);
    const schema = first.schemas[0];
    const inventory = first.rows.find(
        (row) => row.schemaId === "question.slot",
    )!;
    expect(inventory.values.answerSchemaId).toBe(schema.id);
    expect(inventory.values.answerSchemaRevision).toBe(schema.revision);
    expect(inventory.schemaRevision).toBe(2);
    expect(schema.id.startsWith("question.answer.")).toBe(true);
    const repeated = viewFrameRows(structuredClone(view), true);
    expect(repeated.schemas).toEqual(first.schemas);
    expect(repeated.rows).toEqual(first.rows);
    view.definition.schemaView!.slots[0].question += " (updated)";
    const revised = viewFrameRows(view, true);
    expect(revised.schemas[0].id).toBe(schema.id);
    expect(revised.schemas[0].revision).not.toBe(schema.revision);
    for (const row of revised.rows.filter((r) => r.schemaId === schema.id))
        expect(row.schemaRevision).toBe(revised.schemas[0].revision);
    view.definition.schemaView!.slots[0].approval = "rejected";
    expect(viewFrameRows(view, true).schemas).toEqual([]);
});

test("project item keys are section-qualified and evidence remains view-wide", () => {
    const view = JSON.parse(
        readFileSync(
            new URL(
                "../../../client/test/schemaViewFixture.json",
                import.meta.url,
            ),
            "utf8",
        ),
    ) as ViewVersion;
    view.content.kind = "projectBrief";
    view.content.sections = ["first", "second"].map((id) => ({
        id,
        role: "owners" as const,
        heading: id,
        body: "",
        details: {
            kind: "owners" as const,
            assignments: [
                {
                    id: "shared",
                    responsibility: "delivery",
                    owner: null,
                    state: "unassigned" as const,
                },
            ],
        },
    }));
    const projected = viewFrameRows(view, true);
    expect(new Set(projected.rows.map((row) => row.itemKey)).size).toBe(2);
    expect(
        projected.rows.every(
            (row) =>
                row.granularity === "view" &&
                row.evidence.length === view.content.citations.length,
        ),
    ).toBe(true);
    expect(projected.rows.map((row) => row.values.state)).toEqual([
        "unassigned",
        "unassigned",
    ]);
});
