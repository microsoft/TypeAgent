// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import {
    topicBuildInputSchema,
    topicEventReferenceSchema,
} from "./topicProtocol.js";
import {
    schemaViewDefinitionSchema,
    schemaViewContentSchema,
} from "./schemaViewProtocol.js";
import {
    viewMaintenanceDefinitionSchema,
    viewMaintenanceManifestSchema,
    viewMaintenanceSnapshotSchema,
} from "./viewMaintenanceProtocol.js";
export * from "./viewMaintenanceProtocol.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const text = z.string().min(1).max(120000);
const head = z.string().regex(/^[0-9a-f]{40}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const source = z.strictObject({ sourceId: id, revisionId: id });
export const viewSourceUsageRequestSchema = z.strictObject({
    corpusId: id,
    sourceId: id,
    pageSize: z.number().int().min(1).max(200).optional(),
    continuationToken: z
        .string()
        .regex(/^(0|[1-9][0-9]*)$/)
        .optional(),
});
export const viewSourceUsagePageSchema = z.strictObject({
    items: z
        .strictObject({
            viewId: id,
            revisionId: id,
            version: z.number().int().positive(),
            kind: z.enum([
                "troubleshootingGuide",
                "projectBrief",
                "timeline",
                "wiki",
                "schemaView",
            ]),
            title: text,
            state: z.enum(["draft", "stale", "archived"]),
            provenance: z.enum(["human", "generated", "merged"]),
        })
        .array()
        .max(200),
    total: z.number().int().nonnegative(),
    nextContinuationToken: z
        .string()
        .regex(/^(0|[1-9][0-9]*)$/)
        .optional(),
});
const eventEvidence = z.strictObject({ kind: z.literal("event"), eventId: id });
export const viewSelectorSchema = z.discriminatedUnion("kind", [
    z.strictObject({
        kind: z.literal("sources"),
        sources: source.array().max(32),
    }),
    z.strictObject({
        kind: z.literal("timelineEvidence"),
        sources: source.array().max(32),
        events: z.strictObject({ eventId: id }).array().max(32),
    }),
]);
export const viewDefinitionSchema = z
    .strictObject({
        viewId: id,
        kind: z.enum([
            "troubleshootingGuide",
            "projectBrief",
            "timeline",
            "wiki",
            "schemaView",
        ]),
        selector: viewSelectorSchema,
        maintenance: viewMaintenanceDefinitionSchema.optional(),
        wiki: z
            .strictObject({
                construction: z.literal("informational-wiki-v1"),
                query: z.string().trim().min(1).max(200),
                aliases: z.string().trim().min(1).max(200).array().max(7),
                excludedSourceIds: id.array().max(32),
            })
            .optional(),
        projectSummary: z
            .strictObject({
                construction: z.literal("informational-project-summary-v1"),
                query: z.string().trim().min(1).max(200),
                aliases: z.string().trim().min(1).max(200).array().max(7),
                excludedSourceIds: id.array().max(32),
            })
            .optional(),
        schemaView: schemaViewDefinitionSchema.optional(),
    })
    .superRefine((definition, context) => {
        if (
            (definition.kind === "schemaView") !== !!definition.schemaView ||
            (definition.schemaView &&
                (definition.wiki ||
                    definition.projectSummary ||
                    !definition.maintenance))
        )
            context.addIssue({
                code: "custom",
                path: ["schemaView"],
                message:
                    "Schema-defined views require their definition and an explicit maintenance scope",
            });
        if (
            (definition.kind === "wiki") !== !!definition.wiki ||
            (definition.wiki &&
                (definition.maintenance || definition.projectSummary))
        )
            context.addIssue({
                code: "custom",
                path: ["wiki"],
                message: "Wiki construction requires informational-wiki-v1",
            });
        if (
            (definition.kind === "projectBrief") !==
                !!definition.projectSummary ||
            (definition.projectSummary &&
                (definition.maintenance || definition.wiki))
        )
            context.addIssue({
                code: "custom",
                path: ["projectSummary"],
                message:
                    "Project construction requires informational-project-summary-v1",
            });
    });
export const viewMaintenancePlanSchema = z.object({
    corpusId: id,
    expectedHead: head.nullable(),
    targets: z
        .object({
            viewId: id,
            expectedVersion: z.number().int().nonnegative(),
            state: z.enum(["unchanged", "rebuild", "blocked", "pinned"]),
            reason: text,
            selector: viewSelectorSchema.optional(),
            snapshot: viewMaintenanceSnapshotSchema.optional(),
        })
        .array()
        .max(32),
});
const citation = source.extend({
    locator: z
        .string()
        .regex(/^(chars:\d+-\d+|indexed:\d+:[0-9a-f]{64}:\d+-\d+)$/),
    excerpt: text,
    evidence: eventEvidence.optional(),
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
                "projectStatus",
                "projectAsOf",
                "incidentStatus",
                "capacity",
                "owner",
                "milestone",
                "decision",
                "risk",
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
const factStatus = z.enum([
    "observed",
    "proposed",
    "attempted",
    "rejected",
    "deferred",
    "confirmed",
    "unknown",
    "blocked",
    "notApplicable",
]);
const inventoryIds = id.array().min(1).max(128);
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
        "goalsScope",
        "owners",
        "status",
        "milestones",
        "decisions",
        "risks",
    ]),
    heading: text,
    body: text,
});
const sectionEndpoint = z.strictObject({
    kind: z.literal("section"),
    viewId: id,
    sectionId: id,
});
const sourceEndpoint = source.extend({
    kind: z.literal("source"),
    evidence: eventEvidence.optional(),
});
const evidenceEdge = z.strictObject({
    id,
    predicate: z.enum(["supportedBy", "dependsOn"]),
    from: sectionEndpoint,
    to: sourceEndpoint,
    citations: citation.array().min(1),
});
const correctionEdge = evidenceEdge.extend({
    predicate: z.enum(["corrects", "supersedes"]),
    to: sectionEndpoint,
});
const edge = z.union([evidenceEdge, correctionEdge]);
const requestEdge = z.union([
    evidenceEdge.extend({ citations: citation.array().min(1).max(1000) }),
    correctionEdge.extend({ citations: citation.array().min(1).max(1000) }),
]);
const guideContent = z.strictObject({
    kind: z.literal("troubleshootingGuide"),
    title: text,
    summary: text.optional(),
    sections: section.array().min(1).max(1000),
    citations: citation.array(),
});
const informationalProjectDetails = z.discriminatedUnion("kind", [
    z.strictObject({
        kind: z.literal("goalsScope"),
    }),
    z.strictObject({
        kind: z.literal("owners"),
        assignments: z
            .strictObject({
                id,
                responsibility: text,
                state: z.enum(["known", "unknown", "unassigned"]),
                owner: text.nullable(),
            })
            .array()
            .max(128),
    }),
    z.strictObject({
        kind: z.literal("status"),
        project: z.enum(["unknown", "active", "blocked", "complete"]),
        incident: z.enum(["unknown", "open", "closed", "notApplicable"]),
        capacity: z.enum([
            "unknown",
            "pendingOwnerReview",
            "validated",
            "notApplicable",
        ]),
    }),
    z.strictObject({
        kind: z.literal("milestones"),
        items: z
            .strictObject({
                id,
                status: z.enum([
                    "proposed",
                    "confirmed",
                    "blocked",
                    "deferred",
                    "unknown",
                ]),
                date: text.nullable(),
            })
            .array()
            .max(128),
    }),
    z.strictObject({
        kind: z.literal("decisions"),
        items: z.strictObject({ id, status: factStatus }).array().max(128),
    }),
    z.strictObject({
        kind: z.literal("risks"),
        items: z
            .strictObject({
                id,
                status: z.enum(["open", "blocked", "resolved", "unknown"]),
            })
            .array()
            .max(128),
    }),
    z.strictObject({
        kind: z.literal("context"),
        asOf: text.nullable(),
        basis: z.enum(["unknown", "recordEvidence"]),
    }),
]);
const informationalProjectContent = guideContent.extend({
    kind: z.literal("projectBrief"),
    construction: z.literal("informational-project-summary-v1"),
    sections: section
        .extend({ details: informationalProjectDetails })
        .array()
        .length(7),
});
const timelineDetails = z.strictObject({
    kind: z.literal("event"),
    identity: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("canonicalEvent"), eventId: id }),
        z.strictObject({
            kind: z.literal("documentRecord"),
            sourceId: id,
            sourceRecordId: id,
        }),
    ]),
    eventType: text,
    state: factStatus,
    outcome: text.nullable(),
    occurredAt: z.iso.datetime({ offset: true }).nullable(),
    learnedAt: z.iso.datetime({ offset: true }).nullable(),
    capturedAt: z.iso.datetime({ offset: true }).nullable(),
    inventoryIds,
});
const timelineContent = guideContent.extend({
    kind: z.literal("timeline"),
    generatedAt: z.iso.datetime({ offset: true }),
    sections: z
        .strictObject({
            id,
            role: z.literal("event"),
            heading: text,
            body: text,
            details: timelineDetails,
        })
        .array()
        .min(1)
        .max(1000),
});
const wikiContentShape = guideContent.extend({
    kind: z.literal("wiki"),
    construction: z.literal("informational-wiki-v1"),
    index: z
        .strictObject({
            pageId: id,
            title: text,
            taxonomy: z.enum(["concept", "system", "project"]),
        })
        .array()
        .min(1)
        .max(32),
    sections: z
        .strictObject({
            id,
            role: z.literal("page"),
            heading: text,
            body: text,
            details: z.strictObject({
                kind: z.literal("page"),
                construction: z.literal("informational-wiki-v1"),
                taxonomy: z.enum(["concept", "system", "project"]),
                note: z.string().max(4000),
                mergedPageIds: id.array().max(31),
            }),
        })
        .array()
        .min(1)
        .max(32),
});
const wikiContent = wikiContentShape.superRefine((wiki, context) => {
    const root = wiki.sections[0];
    if (!root) {
        context.addIssue({
            code: "custom",
            path: ["sections"],
            message: "Wiki requires at least one page",
        });
        return;
    }
    const children = wiki.sections.slice(1);
    const merged = root.details.mergedPageIds;
    if (
        new Set(wiki.sections.map((page) => page.id)).size !==
            wiki.sections.length ||
        wiki.index.length !== wiki.sections.length ||
        merged.length !== children.length ||
        new Set(merged).size !== merged.length ||
        !children.every(
            (page) =>
                merged.includes(page.id) &&
                page.details.mergedPageIds.length === 0,
        )
    )
        context.addIssue({
            code: "custom",
            path: ["sections"],
            message:
                "Wiki requires one page or an exact registered consolidation index",
        });
    for (const [position, page] of wiki.sections.entries()) {
        const entry = wiki.index[position];
        if (
            entry?.pageId !== page.id ||
            entry.title !== page.heading ||
            entry.taxonomy !== page.details.taxonomy
        )
            context.addIssue({
                code: "custom",
                path: ["index", position],
                message: "Wiki index must match the exact current pages",
            });
    }
});
const content = z.union([
    schemaViewContentSchema,
    guideContent,

    timelineContent,
    wikiContent,
    informationalProjectContent,
]);
const requestContent = z.union([
    schemaViewContentSchema,
    guideContent.extend({ citations: citation.array().max(1000) }),

    timelineContent.extend({ citations: citation.array().max(1000) }),
    wikiContent.safeExtend({ citations: citation.array().max(1000) }),
    informationalProjectContent.extend({
        citations: citation.array().max(1000),
    }),
]);
export const viewSynthesisSchema = z.strictObject({
    content: requestContent,
    relationships: requestEdge.array().max(1000),
    outcome: z.enum([
        "diagnosticOnly",
        "verifiedRecovery",
        "projectSummary",
        "chronology",
        "knowledgePages",
        "schemaAnswers",
    ]),
    missingEvidence: text.array().max(100),
});
const viewSynthesisResponseSchema = viewSynthesisSchema.extend({
    content,
    relationships: edge.array(),
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
    publication: z.boolean().optional(),
});
export const viewSaveRequestSchema = z.strictObject({
    corpusId: id,
    viewId: id,
    expectedHead: head.nullable(),
    expectedVersion: z.number().int().nonnegative(),
    definition: viewDefinitionSchema,
    content: requestContent,
    relationships: requestEdge.array().max(1000),
    unlockProtection: z
        .string()
        .min(1)
        .max(240)
        .array()
        .min(1)
        .max(32)
        .optional(),
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
export const viewEffectivePolicySchema = z.object({
    autoPublish: z.boolean(),
    origin: z.enum(["build", "view", "corpus"]),
    corpusRevision: z.number().int().nonnegative(),
    viewRevision: z.number().int().nonnegative(),
    buildOverride: z.boolean().optional(),
});
export const viewPublicationPolicySchema = z.object({
    revision: z.number().int().nonnegative(),
    autoPublish: z.boolean(),
    views: z.record(
        z.string(),
        z.object({
            revision: z.number().int().nonnegative(),
            autoPublish: z.boolean().nullable(),
        }),
    ),
});
export const viewPublicationPolicyUpdateSchema = z.strictObject({
    corpusId: id,
    expectedHead: head.nullable(),
    expectedRevision: z.number().int().nonnegative(),
    autoPublish: z.boolean().nullable(),
    viewId: id.optional(),
});
export const viewPublishRequestSchema = z.strictObject({
    corpusId: id,
    viewId: id,
    revisionId: id,
    expectedVersion: z.number().int().positive(),
    expectedHead: head,
});
export const viewPublicationStatusSchema = z.object({
    viewId: id,
    latestBuiltRevisionId: id.optional(),
    publishedRevisionId: id.optional(),
    indexedRevisionId: id.optional(),
    intent: z
        .object({ revisionId: id, actor: text, createdAt: z.string() })
        .optional(),
    indexState: z.enum(["absent", "pending", "failed", "ready"]),
    reason: z.string(),
    blockedReason: z.string().optional(),
});
export const viewSearchRequestSchema = z.strictObject({
    corpusId: id,
    query: text,
    limit: z.number().int().min(1).max(100).optional(),
    freshness: z.literal("current"),
    kinds: z
        .enum([
            "troubleshootingGuide",
            "projectBrief",
            "timeline",
            "wiki",
            "schemaView",
        ])
        .array()
        .max(5)
        .optional(),
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
            evidence: eventEvidence.optional(),
            passages: citation.array().optional(),
            records: z
                .object({
                    id,
                    details: timelineDetails.omit({ inventoryIds: true }),
                    citation,
                })
                .array()
                .optional(),
        })
        .array()
        .max(32),
    influenceSources: source.array().optional(),
    influenceEvents: topicEventReferenceSchema.array().optional(),
    topicInput: topicBuildInputSchema.optional(),
    pipeline: z.enum([
        "troubleshooting-v1",
        "timeline-v1",
        "informational-wiki-v1",
        "informational-project-summary-v1",
        "topics-v1",
        "schema-defined-v1",
    ]),
    selectionFingerprint: hash.optional(),
    informationalRetrieval: z
        .strictObject({
            indexGeneration: z.string().uuid(),
            sources: source.array().min(1),
            followSources: source.array(),
        })
        .superRefine((context, issue) => {
            const references = new Map(
                context.sources.map((item) => [item.sourceId, item.revisionId]),
            );
            if (
                references.size !== context.sources.length ||
                new Set(context.followSources.map((item) => item.sourceId))
                    .size !== context.followSources.length ||
                context.followSources.some(
                    (item) => references.get(item.sourceId) !== item.revisionId,
                )
            )
                issue.addIssue({
                    code: "custom",
                    message: "Invalid informational retrieval source scope",
                });
        })
        .optional(),
    model: text,
    fingerprint: hash,
    publicationPolicy: viewEffectivePolicySchema.optional(),
    maintenance: viewMaintenanceSnapshotSchema.optional(),
    editorial: z
        .strictObject({
            generatedBaseId: id,
            targetRevisionId: id,
            generatedBase: z.object({
                content: requestContent,
                relationships: requestEdge.array().max(1000),
            }),
            protectedTargets: z.string().min(1).max(240).array().max(1000),
            unlockedTargets: z.string().min(1).max(240).array().max(1000),
        })
        .optional(),
});
const consolidationReceipt = z.object({
    identity: hash,
    stage: z.enum(["prepared", "accepted", "redirected", "ready", "stale"]),
    survivorViewId: id,
    retiringViewId: id,
    retiringRevisionId: id,
    retiringVersion: z.number().int().positive(),
    input: snapshot,
    output: viewSynthesisSchema,
    anchors: z.strictObject({ from: id, to: id }).array().max(32),
    assessment: z.strictObject({
        relation: z.enum(["samePurpose", "distinct"]),
        reason: z.enum([
            "same-scoped-purpose",
            "distinct-purpose",
            "distinct-scope",
            "unqualified-purpose",
        ]),
        scope: z.strictObject({
            system: z.string().max(200),
            initiative: z.string().max(200),
            purpose: z.string().max(600),
        }),
        criticalDistinctions: z
            .strictObject({
                fragmentId: z.string().regex(/^f(0|[1-9]\d*)$/),
                statement: z.string().min(1).max(600),
            })
            .array()
            .max(12),
    }),
    verification: z.strictObject({
        safe: z.boolean(),
        failures: z
            .enum([
                "quantity",
                "statistic-cohort",
                "command-lease",
                "scope-state",
                "correction-withdrawal",
            ])
            .array()
            .max(5),
    }),
    acceptedRevisionId: id.optional(),
    redirectRevisionId: id.optional(),
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
    publication: z.boolean(),
    maintenancePlan: viewMaintenancePlanSchema.optional(),
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
                "published",
                "searchable",
                "conflicted",
                "blocked",
                "stale",
                "skipped",
                "failed",
                "cancelled",
                "interrupted",
            ]),
            reason: z.string(),
            wikiConsolidation: consolidationReceipt.optional(),
            revisionId: id.optional(),
            topicGeneration: id.optional(),
            conflictId: z.string().uuid().optional(),
            missingEvidence: z.string().array().optional(),
            ...inventoryEvidence,
            publication: viewPublicationStatusSchema.optional(),
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
        protection: z.string().min(1).max(240).array().max(32).optional(),
        unlockedTargets: z.string().min(1).max(240).array().max(32).optional(),
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
    redirect: z
        .strictObject({
            viewId: id,
            acceptedRevisionId: id,
            anchors: z.strictObject({ from: id, to: id }).array().max(32),
        })
        .optional(),
    corpusId: id,
    viewId: id,
    revisionId: id,
    version: z.number().int().positive(),
    state: z.enum(["draft", "stale", "archived"]),
    createdAt: z.string(),
    actor: text,
    protectedTargets: z.string().min(1).max(240).array().max(1000).optional(),
    relatedArticles: z
        .strictObject({ viewId: id, revisionId: id, title: text })
        .array()
        .max(8)
        .optional(),
    baseRevisionId: id.optional(),
    provenance: z.enum(["human", "generated", "merged"]),
    maintenance: viewMaintenanceManifestSchema.optional(),
    validation: z
        .object({
            artifactFingerprint: hash,
            inputFingerprint: hash,
            support: z.object({
                supported: z.boolean(),
                sections: z
                    .object({
                        sectionId: id,
                        supported: z.boolean(),
                        reason: z.string(),
                    })
                    .array()
                    .max(1000),
                relationships: z
                    .object({
                        edgeId: id,
                        supported: z.boolean(),
                        reason: z.string(),
                    })
                    .array()
                    .max(1000),
                missingContext: z.string().array().max(1000),
                reasons: z.string().array().max(1000),
                exclusions: z
                    .object({
                        itemId: id,
                        supported: z.boolean(),
                        reason: z.string(),
                    })
                    .array()
                    .max(128)
                    .optional(),
            }),
        })
        .optional(),
    definition: z.object({
        viewId: id,
        revisionId: id,
        kind: z.enum([
            "troubleshootingGuide",
            "projectBrief",
            "timeline",
            "wiki",
            "schemaView",
        ]),
        selector: viewSelectorSchema,
        maintenance: viewMaintenanceDefinitionSchema.optional(),
        wiki: viewDefinitionSchema.shape.wiki,
        projectSummary: viewDefinitionSchema.shape.projectSummary,
        schemaView: viewDefinitionSchema.shape.schemaView,
    }),
    content: z.union([
        schemaViewContentSchema,
        informationalProjectContent,
        timelineContent,
        wikiContent,
        z.object({
            kind: z.literal("troubleshootingGuide"),
            title: text,
            summary: text.optional(),
            sections: section
                .extend({ heading: z.string().max(120000) })
                .array(),
            citations: source
                .extend({
                    locator: z.string().optional(),
                    excerpt: z.string().optional(),
                })
                .array(),
            agentEdition: z.unknown().optional(),
        }),
    ]),
    generation: z
        .object({
            candidateId: id,
            content: z.unknown(),
            fingerprint: hash,
            relationships: edge.array().optional(),
            input: snapshot.optional(),
            outcome: z
                .enum([
                    "diagnosticOnly",
                    "verifiedRecovery",
                    "projectSummary",
                    "chronology",
                    "knowledgePages",
                    "schemaAnswers",
                ])
                .optional(),
            missingEvidence: z.string().array().max(100).optional(),
            ...inventoryEvidence,
        })
        .optional(),
    edits: edits.optional(),
    relationships: z
        .union([
            evidenceEdge.extend({
                schemaVersion: z.literal(1),
                family: z.enum(["evidence", "dependency"]),
                origin: z.enum(["human", "generator"]),
                reviewState: z.literal("unreviewed"),
            }),
            correctionEdge.extend({
                schemaVersion: z.literal(1),
                family: z.literal("dependency"),
                origin: z.enum(["human", "generator"]),
                reviewState: z.literal("unreviewed"),
            }),
            systemEdge,
        ])
        .array(),
});
export const viewSnapshotSchema = z.object({
    head: head.nullable(),
    views: viewVersionSchema.array(),
    wikiFamily: z
        .strictObject({
            enabled: z.boolean(),
            pending: z.boolean(),
            error: z.string().optional(),
        })
        .optional(),
    projectFamily: z
        .strictObject({
            enabled: z.boolean(),
            pending: z.boolean(),
            error: z.string().optional(),
        })
        .optional(),
});
export const viewHistoryEntrySchema = z.object({
    commitId: head,
    version: viewVersionSchema,
});
export const viewSearchMatchSchema = z.object({
    view: viewVersionSchema,
    score: z.number(),
    snippet: z.string(),
    review: z.literal("unreviewed"),
    freshness: z.literal("current"),
    evidence: citation.array(),
    corroboration: z.literal("derived"),
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
    candidate: viewSynthesisResponseSchema.extend(inventoryEvidence),
    targets: text.array(),
    reason: text,
    resolutionRevisionId: id.optional(),
});

export const viewToolNames = {
    planViewMaintenance: "memory_views_maintenance_plan",
    maintainViews: "memory_views_maintain",
    updateViewMaintenance: "memory_view_maintenance_update",
    getViewMaintenance: "memory_view_maintenance_get",
    listViews: "memory_views_list",
    getSourceViewUsage: "memory_view_source_usage",
    getView: "memory_view_get",
    saveViewDraft: "memory_view_save_draft",
    archiveView: "memory_view_archive",
    getViewHistory: "memory_view_history",
    publishView: "memory_view_publish",
    getViewPublicationPolicy: "memory_view_publication_policy",
    updateViewPublicationPolicy: "memory_view_publication_policy_update",
    getViewPublication: "memory_view_publication_status",
    retryViewIndex: "memory_view_index_retry",
    searchViews: "memory_views_search",
    buildViews: "memory_views_build",
    getViewBuild: "memory_view_build_get",
    listViewBuilds: "memory_view_builds_list",
    cancelViewBuild: "memory_view_build_cancel",
    retryViewBuild: "memory_view_build_retry",
    getViewConflict: "memory_view_conflict_get",
    resolveViewConflict: "memory_view_conflict_resolve",
} as const;

export const viewMaintenanceResultSchema = z.object({
    receiptId: id,
    plan: viewMaintenancePlanSchema,
    job: viewBuildJobSchema.optional(),
});
