// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
    knowledgeDiscoveryUpdateSchema,
    knowledgeCheckpointRequestSchema,
    knowledgeCheckpointWaitSchema,
    knowledgeCheckpointSchema,
    knowledgeStatusSchema,
    knowledgeToolNames,
    questionSlotSchema,
    answerRequestSchema,
    answerResultSchema,
    integratedAnswerDiagnosticsSchema,
} from "../dist/index.js";

const checkpoint = {
    version: 1,
    checkpointId: "checkpoint",
    corpusId: "corpus",
    createdAt: "now",
    updatedAt: "now",
    state: "partial",
    sources: [{ sourceId: "source", revisionId: "revision" }],
    families: ["questions"],
    excludedFamilies: ["wiki"],
    producerComplete: false,
    indexVersion: "index",
    viewIds: [],
    jobIds: [],
    discoveryFingerprints: ["fingerprint"],
    coverage: { inspectedSources: 1, deferredSources: 2 },
    reasons: ["Discovery budget exhausted"],
};
test("checkpoint view revisions round-trip without inventing revisions for legacy checkpoints", () => {
    const maintained = {
        ...checkpoint,
        state: "ready",
        viewIds: ["view"],
        viewRevisions: [{ viewId: "view", revisionId: "view-revision" }],
        reasons: [],
    };
    assert.deepEqual(
        knowledgeCheckpointSchema.parse(JSON.parse(JSON.stringify(maintained))),
        maintained,
    );
    const superseded = {
        ...maintained,
        state: "superseded",
        reasons: ["Captured view revision changed"],
    };
    assert.deepEqual(
        knowledgeCheckpointSchema.parse(JSON.parse(JSON.stringify(superseded))),
        superseded,
    );
    const status = {
        discovery: {
            version: 1,
            policy: "off",
            policyVersion: 1,
            receipts: [],
            routes: [],
            callTimes: [],
        },
        checkpoints: [maintained, superseded],
    };
    assert.deepEqual(
        knowledgeStatusSchema.parse(JSON.parse(JSON.stringify(status))),
        status,
    );
    assert.equal(
        Object.hasOwn(
            knowledgeCheckpointSchema.parse(checkpoint),
            "viewRevisions",
        ),
        false,
    );
    for (const revision of [
        { viewId: "view" },
        { viewId: "view", revisionId: "r", extra: true },
    ])
        assert.equal(
            knowledgeCheckpointSchema.safeParse({
                ...maintained,
                viewRevisions: [revision],
            }).success,
            false,
        );
});
test("knowledge protocol preserves honest fixed-scope states and has finite strict requests", () => {
    for (const policy of ["off", "suggest", "sourceObserved"])
        assert.equal(
            knowledgeDiscoveryUpdateSchema.parse({ corpusId: "c", policy })
                .policy,
            policy,
        );
    assert.deepEqual(knowledgeCheckpointSchema.parse(checkpoint), checkpoint);
    for (const state of [
        "pending",
        "running",
        "ready",
        "partial",
        "blocked",
        "failed",
        "superseded",
        "cancelled",
    ])
        assert.equal(
            knowledgeCheckpointSchema.parse({ ...checkpoint, state }).state,
            state,
        );
    const status = {
        discovery: {
            version: 1,
            policy: "off",
            policyVersion: 1,
            receipts: [],
            routes: [],
            callTimes: [],
            error: "Index unavailable",
        },
        checkpoints: [checkpoint],
    };
    assert.deepEqual(knowledgeStatusSchema.parse(status), status);
    for (const request of [
        { corpusId: "c", policy: "automatic" },
        { corpusId: "c", policy: "sourceObserved", tool: "fetch" },
    ])
        assert.equal(
            knowledgeDiscoveryUpdateSchema.safeParse(request).success,
            false,
        );
    assert.equal(
        knowledgeCheckpointRequestSchema.safeParse({
            corpusId: "c",
            families: ["everything"],
        }).success,
        false,
    );
    assert.equal(
        knowledgeCheckpointWaitSchema.safeParse({
            corpusId: "c",
            checkpointId: "k",
            timeoutMs: Infinity,
        }).success,
        false,
    );
    assert.equal(
        knowledgeCheckpointWaitSchema.safeParse({
            corpusId: "c",
            checkpointId: "k",
            timeoutMs: 300001,
        }).success,
        false,
    );
    assert.equal(
        knowledgeCheckpointWaitSchema.safeParse({
            corpusId: "c",
            checkpointId: "k",
            timeoutMs: 0,
        }).success,
        true,
    );
    assert.equal(new Set(Object.values(knowledgeToolNames)).size, 5);
    assert.doesNotThrow(() => z.toJSONSchema(knowledgeStatusSchema));
});
test("discovery receipt snapshots and legacy receipts round-trip through strict status schemas", () => {
    const receipt = {
        fingerprint: "fingerprint",
        adapterIdentity: "offline-v1",
        input: {
            corpusId: "corpus",
            fingerprint: "fingerprint",
            passages: [
                {
                    sourceId: "source",
                    revisionId: "revision",
                    passageId: "passage",
                    title: "",
                    locator: "chars:0-3",
                    excerpt: "Ada",
                },
            ],
            existingQuestions: ["Who leads Harbor?"],
            maxProposals: 6,
        },
        sources: [{ sourceId: "source", revisionId: "revision" }],
        state: "running",
        attempts: 1,
        startedAt: "now",
        processedProposals: 0,
        viewIds: [],
    };
    const status = {
        discovery: {
            version: 1,
            policy: "sourceObserved",
            policyVersion: 1,
            receipts: [receipt],
            routes: [],
            callTimes: [],
        },
        checkpoints: [],
    };
    assert.deepEqual(
        knowledgeStatusSchema.parse(JSON.parse(JSON.stringify(status))),
        status,
    );
    const {
        input: _input,
        adapterIdentity: _identity,
        processedProposals: _processed,
        ...legacy
    } = receipt;
    const legacyStatus = {
        ...status,
        discovery: { ...status.discovery, receipts: [legacy] },
    };
    assert.deepEqual(knowledgeStatusSchema.parse(legacyStatus), legacyStatus);
    assert.equal(
        knowledgeStatusSchema.safeParse({
            ...status,
            discovery: {
                ...status.discovery,
                receipts: [
                    { ...receipt, input: { ...receipt.input, extra: true } },
                ],
            },
        }).success,
        false,
    );
});

test("policy admission remains distinct from answer review and preserves a source-backed reason", () => {
    const slot = {
        id: "slot",
        question: "What is the name?",
        cardinality: "singleton",
        schema: { type: "string" },
        rubric: {
            version: 1,
            selection: "mostRecent",
            requireConfirmation: false,
            authoritySourceIds: [],
        },
        approval: "approved",
        discoveryCitations: [
            {
                sourceId: "s",
                revisionId: "r",
                locator: "chars:0-3",
                excerpt: "Ada",
            },
        ],
        admission: {
            version: 1,
            actor: "policy",
            policyVersion: 1,
            recipeIdentity: "recipe",
            modelIdentity: "model",
            inputFingerprint: "fingerprint",
            reason: "The source explicitly names a person.",
        },
    };
    assert.deepEqual(questionSlotSchema.parse(slot), slot);
    assert.equal(
        questionSlotSchema.safeParse({
            ...slot,
            admission: { ...slot.admission, humanConfirmed: true },
        }).success,
        false,
    );
    const { admission: _, ...legacy } = slot;
    assert.deepEqual(questionSlotSchema.parse(legacy), legacy);
});
test("integrated answer policies and exact derived/assertion references survive serialization", () => {
    const reference = {
        viewId: "v",
        revisionId: "r",
        sectionId: "section",
        state: "conflicted",
        contractVersion: "contract",
        rubricVersion: "1",
    };
    const result = {
        question: "Name?",
        answer: "There are conflicting reports.",
        mode: "synthesized",
        citations: [],
        grounded: true,
        indexVersion: "index",
        warnings: ["Partial coverage"],
        derivedReferences: [reference],
        assertionReferences: [
            { ...reference, candidateId: "candidate", assertionOrigin: "user" },
        ],
    };
    assert.deepEqual(
        answerResultSchema.parse(JSON.parse(JSON.stringify(result))),
        result,
    );
    assert.equal(
        answerRequestSchema.parse({
            corpusId: "c",
            question: "Name?",
            retrievalPolicy: "sourcesAndViews",
        }).retrievalPolicy,
        "sourcesAndViews",
    );
    assert.equal(
        answerRequestSchema.safeParse({
            corpusId: "c",
            question: "Name?",
            retrievalPolicy: "allowDrafts",
        }).success,
        false,
    );
    assert.equal(
        answerRequestSchema.safeParse({
            corpusId: "c",
            question: "Name?",
            externalTool: "fetch",
        }).success,
        false,
    );
});
test("integrated diagnostics retain visible degraded mode, omitted work and bounded reconstruction", () => {
    const diagnostics = {
        retrievalPolicy: "default",
        retrievalMode: "degraded",
        suppliedEvidence: [
            {
                kind: "derived",
                id: "derived",
                reference: {
                    viewId: "view",
                    revisionId: "revision",
                    state: "unknown",
                },
                text: "The answer is not known in this captured scope.",
                influencingSourceIds: ["source"],
                supportingSources: [],
                opposingSources: [],
                supportingEvidenceIds: [],
                opposingEvidenceIds: [],
                authorship: "informational",
                review: "unreviewed",
                freshness: "current",
                coverage: "partial",
            },
        ],
        selectedEvidenceIds: ["derived"],
        omittedViewCandidates: 3,
        omittedSourceFragments: 2,
        omittedViewBlocks: 1,
        warnings: ["A view index failed; source-only degraded mode"],
        reconstructionCount: 1,
        sourceSelection: {
            terms: ["name"],
            eligibleSourceIds: Array.from(
                { length: 40 },
                (_, index) => `source-${index}`,
            ),
            blocks: [
                {
                    sourceId: "source-39",
                    revisionId: "revision",
                    blockOrdinal: 0,
                    messageOrdinal: 1,
                    score: 1,
                    postingScore: 2,
                    languageScore: 3,
                    preferenceBoost: 0.5,
                    selected: true,
                    emittedFragments: 1,
                    reason: "selected",
                },
            ],
            readChars: 100,
            fragmentCount: 1,
            deliveredFragmentCount: 1,
            responseChars: 200,
            limited: true,
        },
    };
    assert.deepEqual(
        integratedAnswerDiagnosticsSchema.parse(diagnostics),
        diagnostics,
    );
    assert.equal(
        integratedAnswerDiagnosticsSchema.safeParse({
            ...diagnostics,
            reconstructionCount: 2,
        }).success,
        false,
    );
    assert.equal(
        integratedAnswerDiagnosticsSchema.safeParse({
            ...diagnostics,
            hiddenToolAuthority: true,
        }).success,
        false,
    );
    const readerContext = {
        answerPath: "sources-and-views",
        integratedAnswer: diagnostics,
        retrievedMessageOrdinals: [],
        messageOrdinals: [],
        knowledgeMessageOrdinals: [],
        completedChunks: 0,
        serializedContextChars: 100,
        retrievedSourceIds: [],
        messageSourceIds: [],
        knowledgeSourceIds: [],
    };
    const result = {
        question: "Name?",
        answer: "Unknown",
        mode: "synthesized",
        citations: [],
        grounded: true,
        indexVersion: "index",
        warnings: diagnostics.warnings,
        readerContext,
    };
    assert.deepEqual(answerResultSchema.parse(result), result);
});
