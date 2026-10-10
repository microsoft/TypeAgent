// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import { validateAgentEdition } from "@typeagent/memory-service/agent-edition-validation";
import type { MemoryHubRunbookFunctions } from "@typeagent/browser-control-rpc/viewRpc";

const text = z.string().min(1).max(8192);
const version = z.number().int().positive();
const corpus = { corpusId: text };
const procedure = { ...corpus, procedureId: text };
const identity = z.strictObject({
    scope: z.enum(["builtin", "user", "project", "package"]),
    origin: text,
    name: text,
});
const page = {
    pageSize: z.number().int().min(1).max(100).optional(),
    continuationToken: text.optional(),
};
const offset = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const state = z.enum([
    "draft",
    "validated",
    "approved",
    "active",
    "disabled",
    "archived",
]);
const edition = z.unknown().superRefine((value, context) => {
    try {
        validateAgentEdition(value);
    } catch (error) {
        context.addIssue({
            code: "custom",
            message: error instanceof Error ? error.message : String(error),
        });
    }
});

export const runbookProcedureDocumentSchema = z.strictObject({
    title: text,
    summary: text.optional(),
    steps: z.array(text).max(10000),
    citations: z
        .array(
            z.strictObject({
                sourceId: text,
                revisionId: text,
                locator: text.optional(),
                excerpt: text.optional(),
            }),
        )
        .max(10000),
    additionalSections: z
        .array(
            z.strictObject({
                heading: text,
                content: z.string().max(1000000),
            }),
        )
        .max(10000)
        .optional(),
    agentEdition: edition.optional(),
});
export const runbookSaveSchema = z.strictObject({
    ...corpus,
    procedureId: text.optional(),
    candidateId: text.optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
    document: runbookProcedureDocumentSchema.optional(),
    markdown: z.string().max(10000000).optional(),
    reviewAgentEdition: z.boolean().optional(),
    safetyConfirmed: z.boolean().optional(),
});
const skillRequest = {
    ...procedure,
    version,
    identity,
    description: text.optional(),
};

export const runbookViewSchemas: Record<
    keyof MemoryHubRunbookFunctions,
    z.ZodType
> = {
    memoryHubRunbooks: z.strictObject({
        corpusId: text.optional(),
        query: text.optional(),
        ...page,
        readiness: z
            .array(
                z.enum([
                    "detected",
                    "howto",
                    "runbook",
                    "toolsBound",
                    "skill",
                    "active",
                ]),
            )
            .max(6)
            .optional(),
        states: z
            .array(z.enum(["detected", "draft", "saved", "stale", "archived"]))
            .max(5)
            .optional(),
        needsReview: z.boolean().optional(),
    }),
    memoryHubRunbook: z.discriminatedUnion("kind", [
        z.strictObject({
            ...corpus,
            kind: z.literal("candidate"),
            objectId: text,
        }),
        z.strictObject({
            ...corpus,
            kind: z.literal("procedure"),
            objectId: text,
            version: version.optional(),
            skillRevisionId: text.optional(),
        }),
    ]),
    memoryHubSaveRunbook: runbookSaveSchema,
    memoryHubRunbookHistory: z.strictObject({
        ...procedure,
        beforeVersion: version.optional(),
        pageSize: page.pageSize,
    }),
    memoryHubRunbookOriginal: z.strictObject({
        ...corpus,
        sourceId: text,
        revisionId: text,
        locator: text.optional(),
        offset: offset.optional(),
    }),
    memoryHubRunbookUsedBy: z.strictObject({
        ...corpus,
        sourceId: text,
        ...page,
        viewContinuationToken: text.optional(),
    }),
    memoryHubSuggestBindings: z.strictObject({
        ...procedure,
        version,
        stepId: text,
    }),
    memoryHubAcceptBinding: z
        .strictObject({
            ...procedure,
            expectedVersion: version,
            stepId: text,
            targetId: text.optional(),
            fingerprint: text.optional(),
            targetVersion: text.optional(),
            arguments: z.record(z.string(), z.json()).optional(),
            command: text.optional(),
            manualReason: text.optional(),
            safety: z.enum(["readOnly", "changesData", "unknown"]),
            safetyConfirmed: z.boolean(),
        })
        .superRefine((value, context) => {
            const choices = [
                value.targetId,
                value.command,
                value.manualReason,
            ].filter((item) => item !== undefined);
            if (choices.length !== 1) {
                context.addIssue({
                    code: "custom",
                    message:
                        "Choose exactly one catalog target, command, or manual step",
                });
            }
            if (
                value.targetId !== undefined &&
                (value.fingerprint === undefined ||
                    value.targetVersion === undefined)
            ) {
                context.addIssue({
                    code: "custom",
                    message:
                        "Catalog bindings require an exact version and fingerprint",
                });
            }
            if (
                value.targetId === undefined &&
                (value.fingerprint !== undefined ||
                    value.targetVersion !== undefined ||
                    value.arguments !== undefined)
            ) {
                context.addIssue({
                    code: "custom",
                    message: "Catalog metadata requires a catalog target",
                });
            }
        }),
    memoryHubPreviewSkill: z.strictObject(skillRequest),
    memoryHubPublishSkill: z.strictObject(skillRequest),
    memoryHubSkillAction: z.strictObject({
        identity,
        revisionId: text,
        expectedState: state,
        expectedActive: z.boolean(),
        action: z.enum([
            "validate",
            "approve",
            "activate",
            "disable",
            "archive",
            "rollback",
            "draft",
        ]),
    }),
    memoryHubSkillFile: z.strictObject({
        identity,
        revisionId: text,
        path: text,
    }),
    memoryHubCompareRunbook: z.strictObject({ ...procedure, version }),
    memoryHubSynthesizeRunbook: z.strictObject({
        ...procedure,
        version,
        sourceId: text,
        revisionId: text,
    }),
    memoryHubReadRunbookAsset: z.strictObject({
        ...corpus,
        sourceId: text,
        revisionId: text,
        assetId: text,
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        variant: z.enum(["original", "preview"]),
        acknowledgeUnreviewed: z.boolean().optional(),
    }),
};
