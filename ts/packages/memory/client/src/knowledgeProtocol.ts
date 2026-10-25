// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import { questionSlotSchema } from "./schemaViewProtocol.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);
const text = z.string().min(1).max(120000);
const source = z.strictObject({ sourceId: id, revisionId: id });
const family = z.enum(["questions", "wiki", "projects", "topics"]);
const timeoutMs = z.number().int().min(0).max(300000).optional();
export const discoveryPolicySchema = z.enum([
    "off",
    "suggest",
    "sourceObserved",
]);
export const knowledgeCorpusRequestSchema = z.strictObject({ corpusId: id });
export const knowledgeDiscoveryUpdateSchema = z.strictObject({
    corpusId: id,
    policy: discoveryPolicySchema,
    retryFailed: z.boolean().optional(),
});
export const knowledgeCheckpointRequestSchema = z.strictObject({
    corpusId: id,
    sourceIds: id.array().max(100000).optional(),
    families: family.array().max(4).optional(),
    producerComplete: z.boolean().optional(),
    timeoutMs,
});
export const knowledgeCheckpointReadSchema = z.strictObject({
    corpusId: id,
    checkpointId: id,
});
export const knowledgeCheckpointWaitSchema =
    knowledgeCheckpointReadSchema.extend({
        timeoutMs,
    });
const corpusQuestionInputSchema = z.strictObject({
    corpusId: id,
    fingerprint: text,
    passages: questionSlotSchema.shape.discoveryCitations.element
        .extend({
            passageId: id,
            title: z.string().max(120000),
        })
        .array()
        .max(24),
    existingQuestions: text.array().max(100000),
    existingContracts: questionSlotSchema.array().max(64).optional(),
    existingContractCount: z.number().int().nonnegative().optional(),
    maxProposals: z.number().int().min(0).max(64),
});
export const knowledgeCheckpointSchema = z.strictObject({
    version: z.literal(1),
    checkpointId: id,
    corpusId: id,
    createdAt: text,
    updatedAt: text,
    state: z.enum([
        "pending",
        "running",
        "ready",
        "partial",
        "blocked",
        "failed",
        "superseded",
        "cancelled",
    ]),
    sources: source.array().max(100000),
    families: family.array().max(4),
    excludedFamilies: family.array().max(4),
    producerComplete: z.boolean(),
    indexVersion: text,
    viewIds: id.array().max(100000),
    viewRevisions: z
        .strictObject({
            viewId: id,
            revisionId: id,
        })
        .array()
        .max(100000)
        .optional(),
    jobIds: id.array().max(100000),
    discoveryFingerprints: text.array().max(100000),
    coverage: z.strictObject({
        inspectedSources: z.number().int().nonnegative(),
        deferredSources: z.number().int().nonnegative(),
    }),
    reasons: text.array().max(1000),
});
export const knowledgeStatusSchema = z.strictObject({
    discovery: z.strictObject({
        version: z.literal(1),
        policy: discoveryPolicySchema,
        policyVersion: z.literal(1),
        receipts: z
            .strictObject({
                fingerprint: text,
                input: corpusQuestionInputSchema.optional(),
                adapterIdentity: text.optional(),
                sources: source.array().max(100000),
                state: z.enum(["running", "complete", "failed", "deferred"]),
                attempts: z.number().int().nonnegative(),
                startedAt: text,
                completedAt: text.optional(),
                proposals: z
                    .strictObject({
                        subject: text,
                        reason: text,
                        slot: questionSlotSchema,
                        utility: z
                            .strictObject({
                                consumerValue: z.number().int().min(0).max(2),
                                substance: z.number().int().min(0).max(2),
                                novelty: z.number().int().min(0).max(2),
                                durability: z.number().int().min(0).max(2),
                            })
                            .optional(),
                    })
                    .array()
                    .max(64)
                    .optional(),
                processedProposals: z.number().int().nonnegative().optional(),
                viewIds: id.array().max(100000),
                reason: text.optional(),
            })
            .array()
            .max(100000),
        routes: z
            .strictObject({
                viewId: id,
                subject: text,
                terms: text.array().max(1000),
                sourceIds: id.array().max(100000),
                detached: z.boolean().optional(),
            })
            .array()
            .max(100000),
        callTimes: z.number().finite().nonnegative().array().max(100000),
        error: text.optional(),
    }),
    checkpoints: knowledgeCheckpointSchema.array().max(100000),
});
export const knowledgeToolNames = {
    getKnowledgeStatus: "memory_knowledge_status",
    updateKnowledgeDiscovery: "memory_knowledge_discovery_update",
    createKnowledgeCheckpoint: "memory_knowledge_checkpoint_create",
    getKnowledgeCheckpoint: "memory_knowledge_checkpoint_get",
    waitForKnowledgeCheckpoint: "memory_knowledge_checkpoint_wait",
} as const;
