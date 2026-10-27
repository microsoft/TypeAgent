// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import {
    viewVersionSchema,
    viewSnapshotSchema,
    viewSaveRequestSchema,
    viewSourceUsagePageSchema,
    viewBuildJobSchema,
    viewSearchRequestSchema,
    questionInventorySchema,
    questionEditRequestSchema,
    schemaViewProposalRequestSchema,
    schemaViewDefinitionSchema,
    schemaViewContentSchema,
    answerSchemaSchema,
    schemaValueSchema,
    acquisitionProgressSchema,
    projectAcquisitionProgress,
    safeAcquisitionOperation,
    viewBuildSummarySchema,
    viewSummaryRequestSchema,
} from "../dist/index.js";

const view = JSON.parse(
    readFileSync(new URL("./schemaViewFixture.json", import.meta.url), "utf8"),
);
const base = {
    corpusId: "corpus",
    viewId: "profile",
    expectedHead: null,
    expectedVersion: 1,
};
test("view inventory queries accept bounded kind exclusions without changing default discovery", () => {
    const request = {
        corpusId: "corpus",
        pageSize: 1,
        excludeKinds: ["schemaView"],
    };
    assert.deepEqual(viewSummaryRequestSchema.parse(request), request);
    assert.deepEqual(viewSummaryRequestSchema.parse({ corpusId: "corpus" }), {
        corpusId: "corpus",
    });
    assert.equal(
        viewSummaryRequestSchema.safeParse({
            ...request,
            excludeKinds: ["unknown"],
        }).success,
        false,
    );
    assert.equal(
        viewSummaryRequestSchema.safeParse({
            ...request,
            excludeKinds: Array(6).fill("schemaView"),
        }).success,
        false,
    );
});
test("build summaries preserve lightweight conflict state and accept legacy responses", () => {
    const summary = {
        jobId: "00000000-0000-4000-8000-000000000001",
        corpusId: "corpus",
        createdAt: "2026-10-27T00:00:00Z",
        updatedAt: "2026-10-27T00:00:00Z",
        state: "partial",
        maintenance: false,
        results: [
            {
                viewId: "guide",
                state: "conflicted",
                reason: "Review overlap",
                conflictId: "00000000-0000-4000-8000-000000000002",
                current: true,
                snapshot: {
                    pipeline: "informational-wiki-v1",
                    definition: { kind: "wiki" },
                },
            },
        ],
    };
    assert.equal(
        viewBuildSummarySchema.parse(summary).results[0].conflictState,
        undefined,
    );
    for (const conflictState of ["pending", "resolved", "missing"]) {
        const current = structuredClone(summary);
        current.results[0].conflictState = conflictState;
        assert.equal(
            viewBuildSummarySchema.parse(current).results[0].conflictState,
            conflictState,
        );
    }
});
test("generic view protocol preserves scoped local chronology without a timezone", () => {
    const local = structuredClone(view);
    const details = local.content.sections[0].details;
    const citation = {
        sourceId: "log",
        revisionId: "revision",
        locator: "chars:0-3",
        excerpt: "log",
    };
    const localChronology = {
        timestamp: "2031-04-09T13:45",
        scope: "Workshop log common local clock",
    };
    details.candidates = [
        {
            id: "candidate",
            value: "beta",
            origin: "source",
            review: "unreviewed",
            citations: [citation],
            opposingCitations: [],
            localChronology,
            derivedFrom: [],
            support: [{ citation, localChronology, derivedFrom: [] }],
        },
    ];
    assert.deepEqual(viewVersionSchema.parse(local), local);
    details.candidates[0].localChronology.timestamp += "Z";
    assert.equal(viewVersionSchema.safeParse(local).success, false);
});

test("generic view protocols preserve complete schema questions and reject construction mismatches", () => {
    assert.deepEqual(viewVersionSchema.parse(view), view);
    assert.deepEqual(
        viewSnapshotSchema.parse({ head: null, views: [view] }).views[0],
        view,
    );
    const { revisionId: _revision, ...definition } = view.definition;
    const draft = {
        ...base,
        definition,
        content: view.content,
        relationships: [],
    };
    assert.deepEqual(viewSaveRequestSchema.parse(draft), draft);
    assert.equal(
        viewSaveRequestSchema.safeParse({
            ...draft,
            definition: { ...definition, kind: "timeline" },
        }).success,
        false,
    );
    assert.equal(
        schemaViewContentSchema.safeParse({ ...view.content, agentEdition: {} })
            .success,
        false,
    );
    assert.equal(
        viewSearchRequestSchema.safeParse({
            corpusId: "corpus",
            query: "name",
            freshness: "current",
            kinds: ["schemaView"],
        }).success,
        true,
    );
    assert.equal(
        viewSourceUsagePageSchema.safeParse({
            items: [
                {
                    viewId: "profile",
                    revisionId: "r",
                    version: 1,
                    kind: "schemaView",
                    title: "Profile",
                    state: "draft",
                    provenance: "human",
                },
            ],
            total: 1,
        }).success,
        true,
    );
});
test("restricted schemas are finite and all cardinalities preserve typed definitions", () => {
    for (const cardinality of ["singleton", "record", "collection"]) {
        const definition = structuredClone(view.definition.schemaView);
        definition.slots[0].cardinality = cardinality;
        definition.slots[0].schema = {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
        };
        if (cardinality === "collection") definition.slots[0].itemKey = "name";
        assert.deepEqual(
            schemaViewDefinitionSchema.parse(definition),
            definition,
        );
    }
    assert.equal(
        answerSchemaSchema.safeParse({
            type: "array",
            items: { type: "string" },
        }).success,
        false,
    );
    let schema = { type: "string" };
    let value = "Ada";
    for (let index = 0; index < 7; index++) {
        schema = {
            type: "object",
            properties: { child: schema },
            required: ["child"],
        };
        value = { child: value };
    }
    assert.equal(answerSchemaSchema.safeParse(schema).success, false);
    assert.equal(schemaValueSchema.safeParse(value).success, false);
    assert.equal(
        schemaValueSchema.safeParse(Array(1001).fill("Ada")).success,
        false,
    );
    assert.doesNotThrow(() => z.toJSONSchema(schemaViewDefinitionSchema));
});
test("question inventory, typed edits and proposal scopes remain guarded", () => {
    const question = {
        corpusId: "corpus",
        viewId: "profile",
        viewTitle: "Profile",
        viewVersion: 1,
        viewRevisionId: "r",
        definitionRevision: "contract",
        slot: view.definition.schemaView.slots[0],
        details: view.content.sections[0].details,
        attentionScore: 10,
        fingerprint: "fingerprint",
    };
    assert.deepEqual(
        questionInventorySchema.parse({
            head: null,
            items: [question],
            maintenanceError: "Pending source evaluation",
        }).items[0],
        question,
    );
    for (const maxProposals of [0, 8])
        assert.equal(
            questionEditRequestSchema.safeParse({
                ...base,
                slotId: "name",
                edit: { kind: "discovery", enabled: true, maxProposals },
            }).success,
            true,
        );
    assert.equal(
        questionEditRequestSchema.safeParse({
            ...base,
            slotId: "name",
            edit: { kind: "discovery", enabled: true, maxProposals: 9 },
        }).success,
        false,
    );
    assert.equal(
        schemaViewProposalRequestSchema.safeParse({
            ...base,
            specification: "A form",
        }).success,
        false,
    );
    assert.equal(
        schemaViewProposalRequestSchema.safeParse({
            ...base,
            specification: "A form",
            maintenance: view.definition.maintenance,
        }).success,
        true,
    );
});
test("schema pipeline build receipts preserve generation content and outcomes", () => {
    const snapshot = {
        corpusId: "corpus",
        actor: "offline",
        definition: { ...view.definition },
        expectedVersion: 1,
        bounds: {},
        inputs: [],
        pipeline: "schema-defined-v1",
        model: "offline",
        fingerprint: "a".repeat(64),
    };
    delete snapshot.definition.revisionId;
    const job = {
        jobId: "11111111-1111-4111-8111-111111111111",
        corpusId: "corpus",
        fingerprint: "a".repeat(64),
        request: {
            corpusId: "corpus",
            expectedHead: null,
            targets: [{ definition: snapshot.definition, expectedVersion: 1 }],
        },
        actor: "offline",
        createdAt: "now",
        updatedAt: "now",
        state: "complete",
        publication: false,
        results: [
            {
                viewId: "profile",
                snapshot,
                state: "draft",
                reason: "Schema answers evaluated",
                synthesis: {
                    content: view.content,
                    relationships: [],
                    outcome: "schemaAnswers",
                    missingEvidence: [],
                },
            },
        ],
    };
    assert.deepEqual(
        viewBuildJobSchema.parse(job).results[0].snapshot.pipeline,
        "schema-defined-v1",
    );
    const generation = {
        candidateId: "candidate",
        content: view.content,
        fingerprint: "a".repeat(64),
        outcome: "schemaAnswers",
        input: snapshot,
    };
    assert.equal(
        viewVersionSchema.parse({ ...view, generation }).generation.outcome,
        "schemaAnswers",
    );
});
test("acquisition projections exclude sensitive data and errors remain sanitized", async () => {
    const request = {
        corpusId: "corpus",
        requestId: "request",
        sourceId: "source",
        state: "ingested",
        createdAt: "now",
        updatedAt: "now",
        calls: 1,
        retries: 0,
        consumers: [
            {
                viewId: "profile",
                slotId: "name",
                definitionRevision: "contract",
                extra: "PRIVATE",
            },
        ],
        principalId: "PRIVATE",
        authorizedArguments: { query: "PRIVATE" },
        staged: { content: "PRIVATE" },
        error: "PRIVATE",
        receipt: {
            jobId: "job",
            revisionId: "revision",
            state: "complete",
            statusUri: "PRIVATE",
        },
    };
    const progress = projectAcquisitionProgress(request);
    assert.equal(JSON.stringify(progress).includes("PRIVATE"), false);
    assert.deepEqual(acquisitionProgressSchema.parse(progress), progress);
    assert.equal(
        acquisitionProgressSchema.safeParse({
            ...progress,
            staged: request.staged,
        }).success,
        false,
    );
    await assert.rejects(
        () =>
            safeAcquisitionOperation(async () => {
                throw new Error("PRIVATE");
            }),
        (error) => !error.message.includes("PRIVATE"),
    );
});
