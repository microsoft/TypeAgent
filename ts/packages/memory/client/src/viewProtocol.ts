// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const text = z.string().min(1).max(120000);
const head = z.string().regex(/^[0-9a-f]{40}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const source = z.strictObject({ sourceId: id, revisionId: id });
export const viewSelectorSchema = z.strictObject({
    kind: z.literal("sources"),
    sources: source.array().max(32),
});
export const viewDefinitionSchema = z.strictObject({
    viewId: id,
    kind: z.literal("troubleshootingGuide"),
    selector: viewSelectorSchema,
});
const citation = source.extend({
    locator: z.string().regex(/^chars:\d+-\d+$/),
    excerpt: text,
});
const inventory = z.object({
    schemaVersion: z.literal(1),
    sourceFingerprint: hash,
    fingerprint: hash,
    items: z
        .object({
            id,
            key: id,
            kind: z.enum([
                "goal",
                "measurement",
                "approach",
                "prerequisite",
                "authority",
                "recovery",
                "outcome",
                "unresolved",
                "reuseWarning",
                "timing",
                "background",
            ]),
            status: z.enum([
                "observed",
                "proposed",
                "attempted",
                "rejected",
                "deferred",
                "confirmed",
                "unknown",
                "blocked",
                "notApplicable",
            ]),
            statement: text,
            measurements: z
                .object({ quantity: text, unit: text, context: text })
                .array()
                .max(16),
            occurredAt: z.string().max(200),
            learnedAt: z.string().max(200),
            citations: citation.array().min(1).max(2000),
        })
        .array()
        .min(1)
        .max(128),
    sourceDecisions: z
        .object({
            id,
            sourceId: id,
            passageIds: id.array().min(1).max(2000),
            disposition: z.enum([
                "represented",
                "metadata",
                "duplicate",
                "outsideScope",
            ]),
            itemIds: id.array().max(128),
            reason: z.string().min(1).max(1800),
        })
        .array()
        .max(2000),
});
const inventoryAudit = z.object({
    supported: z.boolean(),
    items: z
        .object({ itemId: id, supported: z.boolean(), reason: text })
        .array()
        .max(128),
    decisions: z
        .object({ decisionId: id, supported: z.boolean(), reason: text })
        .array()
        .max(2000),
    missingFacts: z
        .object({
            sourceId: id,
            passageIds: id.array().max(2000),
            description: text,
        })
        .array()
        .max(2000),
    reasons: text.array().max(2000),
});
const coverage = z.object({
    inventoryFingerprint: hash,
    items: z
        .object({
            itemId: id,
            state: z.enum(["covered", "excluded"]),
            sectionId: id.optional(),
            locator: z
                .string()
                .regex(/^chars:\d+-\d+$/)
                .optional(),
            excerpt: text.optional(),
            justification: z.string().min(1).max(1800).optional(),
            exclusion: z.enum(["duplicate", "outsideScope"]).optional(),
            duplicateOf: id.optional(),
        })
        .array()
        .max(128),
    reuseEligibility: z.enum(["diagnosticOnly", "requiresFreshEvidence"]),
});
const inventoryEvidence = {
    inventory: inventory.optional(),
    inventoryAudit: inventoryAudit.optional(),
    coverage: coverage.optional(),
};
const section = z.strictObject({
    id,
    role: z.enum([
        "description",
        "prerequisites",
        "diagnostic",
        "guard",
        "verification",
        "recovery",
        "context",
    ]),
    heading: text,
    body: text,
});
const sectionEndpoint = z.strictObject({
    kind: z.literal("section"),
    viewId: id,
    sectionId: id,
});
const sourceEndpoint = source.extend({ kind: z.literal("source") });
const edge = z.strictObject({
    id,
    predicate: z.enum(["supportedBy", "dependsOn"]),
    from: sectionEndpoint,
    to: sourceEndpoint,
    citations: citation.array().min(1).max(1000),
});
const content = z.strictObject({
    kind: z.literal("troubleshootingGuide"),
    title: text,
    summary: text.optional(),
    sections: section.array().min(1).max(1000),
    citations: citation.array().max(1000),
});
export const viewSynthesisSchema = z.strictObject({
    content,
    relationships: edge.array().max(1000),
    outcome: z.enum(["diagnosticOnly", "verifiedRecovery"]),
    missingEvidence: text.array().max(100),
});
const bounds = z.strictObject({
    learnedBefore: z.iso.datetime({ offset: true }).optional(),
    occurredFrom: z.iso.datetime({ offset: true }).optional(),
    occurredTo: z.iso.datetime({ offset: true }).optional(),
});
export const viewBuildRequestSchema = z.strictObject({
    corpusId: id,
    expectedHead: head.nullable(),
    targets: z
        .strictObject({
            definition: viewDefinitionSchema,
            expectedVersion: z.number().int().nonnegative(),
        })
        .array()
        .min(1)
        .max(32),
    bounds: bounds.optional(),
    publication: z.literal(false).optional(),
});
export const viewSaveRequestSchema = z.strictObject({
    corpusId: id,
    viewId: id,
    expectedHead: head.nullable(),
    expectedVersion: z.number().int().nonnegative(),
    definition: viewDefinitionSchema,
    content,
    relationships: edge.array().max(1000),
});
export const viewReadRequestSchema = z.strictObject({
    corpusId: id,
    viewId: id,
    revisionId: id.optional(),
});
export const viewArchiveRequestSchema = z.strictObject({
    corpusId: id,
    viewId: id,
    expectedHead: head,
    expectedVersion: z.number().int().positive(),
});
export const viewBuildJobRequestSchema = z.strictObject({
    corpusId: id,
    jobId: z.string().uuid(),
});
export const viewConflictReadSchema = z.strictObject({
    corpusId: id,
    conflictId: z.string().uuid(),
});
export const viewResolutionSchema = z.strictObject({
    corpusId: id,
    conflictId: z.string().uuid(),
    expectedHead: head,
    expectedVersion: z.number().int().positive(),
    expectedRevisionId: id,
    inputFingerprint: hash,
    choice: z.enum(["human", "generated", "combined"]),
    combined: viewSynthesisSchema.optional(),
});
const snapshot = z.object({
    corpusId: id,
    actor: text,
    definition: viewDefinitionSchema,
    definitionRevisionId: id.optional(),
    targetRevisionId: id.optional(),
    expectedVersion: z.number().int().nonnegative(),
    bounds,
    inputs: source
        .extend({
            title: text,
            content: z.string().max(120000),
            contentHash: hash,
            learnedAt: z.string().optional(),
            occurredAt: z.string().optional(),
        })
        .array()
        .min(1)
        .max(32),
    pipeline: z.literal("troubleshooting-v1"),
    model: text,
    fingerprint: hash,
});
export const viewBuildJobSchema = z.object({
    jobId: z.string().uuid(),
    corpusId: id,
    fingerprint: hash,
    request: viewBuildRequestSchema,
    actor: text,
    createdAt: z.string(),
    updatedAt: z.string(),
    state: z.enum([
        "running",
        "complete",
        "partial",
        "failed",
        "cancelled",
        "interrupted",
    ]),
    publication: z.literal(false),
    results: z
        .object({
            viewId: id,
            snapshot,
            state: z.enum([
                "pending",
                "inventorying",
                "checkingInventory",
                "generating",
                "validating",
                "draft",
                "merged",
                "conflicted",
                "blocked",
                "stale",
                "skipped",
                "failed",
                "cancelled",
                "interrupted",
            ]),
            reason: z.string(),
            revisionId: id.optional(),
            conflictId: z.string().uuid().optional(),
            missingEvidence: z.string().array().optional(),
            ...inventoryEvidence,
        })
        .array()
        .max(32),
});
const edits = z
    .object({
        id: z.string().uuid(),
        target: text,
        actor: text,
        createdAt: z.string(),
        generatedBaseId: id.optional(),
        baseFingerprint: hash.optional(),
        oldHash: hash,
        oldValue: z.unknown().optional(),
        newValue: z.unknown().optional(),
        operation: z.enum(["set", "delete"]),
        status: z.enum(["active", "merged", "conflicted", "cleared"]),
    })
    .array();
const systemEdge = z.object({
    id,
    schemaVersion: z.literal(1),
    family: z.enum(["lineage", "dependency"]),
    origin: z.literal("system"),
    predicate: z.enum(["generatedFrom", "dependsOn"]),
    from: z.object({ kind: z.literal("view"), viewId: id, revisionId: id }),
    to: z.union([
        sourceEndpoint,
        z.object({ kind: z.literal("definition"), viewId: id, revisionId: id }),
    ]),
});
export const viewVersionSchema = z.object({
    corpusId: id,
    viewId: id,
    revisionId: id,
    version: z.number().int().positive(),
    state: z.enum(["draft", "stale", "archived"]),
    createdAt: z.string(),
    actor: text,
    baseRevisionId: id.optional(),
    provenance: z.enum(["human", "procedure", "generated", "merged"]),
    definition: z.object({
        viewId: id,
        revisionId: id,
        kind: z.enum(["troubleshootingGuide", "procedure"]),
        selector: viewSelectorSchema.extend({ sources: source.array() }),
    }),
    content: z.object({
        kind: z.enum(["troubleshootingGuide", "procedure"]),
        title: text,
        summary: text.optional(),
        sections: section.extend({ heading: z.string().max(120000) }).array(),
        citations: source
            .extend({
                locator: z.string().optional(),
                excerpt: z.string().optional(),
            })
            .array(),
        compatibilityFields: z.record(z.string(), z.unknown()).optional(),
        agentEdition: z.unknown().optional(),
    }),
    generation: z
        .object({
            candidateId: id,
            content: z.unknown(),
            fingerprint: hash,
            relationships: edge.array().optional(),
            input: snapshot.optional(),
            outcome: z.enum(["diagnosticOnly", "verifiedRecovery"]).optional(),
            ...inventoryEvidence,
        })
        .optional(),
    edits: edits.optional(),
    relationships: z
        .union([
            edge.extend({
                schemaVersion: z.literal(1),
                family: z.enum(["evidence", "dependency"]),
                origin: z.enum(["human", "generator"]),
                reviewState: z.literal("unreviewed"),
            }),
            systemEdge,
        ])
        .array(),
    compatibility: z.unknown().optional(),
});
export const viewSnapshotSchema = z.object({
    head: head.nullable(),
    views: viewVersionSchema.array(),
});
export const viewHistoryEntrySchema = z.object({
    commitId: head,
    version: viewVersionSchema,
});
export const viewConflictSchema = z.object({
    event: z.object({
        kind: z.literal("viewMergeConflict"),
        editIds: z.string().uuid().array(),
        evidence: source.array(),
    }),
    conflictId: z.string().uuid(),
    identity: hash,
    corpusId: id,
    viewId: id,
    jobId: z.string().uuid(),
    createdAt: z.string(),
    actor: text,
    state: z.enum(["pending", "resolved"]),
    expectedRevisionId: id,
    input: snapshot,
    base: viewVersionSchema.shape.generation.optional(),
    human: viewVersionSchema,
    candidate: viewSynthesisSchema.extend(inventoryEvidence),
    targets: text.array(),
    reason: text,
    resolutionRevisionId: id.optional(),
});

export const viewToolNames = {
    listViews: "memory_views_list",
    getView: "memory_view_get",
    saveViewDraft: "memory_view_save_draft",
    archiveView: "memory_view_archive",
    getViewHistory: "memory_view_history",
    publishView: "memory_view_publish",
    buildViews: "memory_views_build",
    getViewBuild: "memory_view_build_get",
    listViewBuilds: "memory_view_builds_list",
    cancelViewBuild: "memory_view_build_cancel",
    retryViewBuild: "memory_view_build_retry",
    getViewConflict: "memory_view_conflict_get",
    resolveViewConflict: "memory_view_conflict_resolve",
} as const;
