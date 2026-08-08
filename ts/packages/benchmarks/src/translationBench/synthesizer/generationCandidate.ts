// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    fromJSONParsedActionSchema,
    validateAction,
} from "@typeagent/action-schema";
import { z } from "zod";

import {
    isChatHistoryInput,
    type ChatHistoryInput,
} from "agent-dispatcher/internal";
import {
    type TranslationBenchBenchmarkAction,
    type TranslationBenchBenchmarkProbePayload,
    type TranslationBenchBenchmarkSchema,
    type TranslationBenchTargetAction,
} from "./benchmark.js";
import {
    assertTranslationBenchExpectedActionArity,
    normalizeTranslationBenchActionShapePolicy,
    type TranslationBenchActionShapePolicy,
} from "./actionShape.js";
import { stripEmptyGoldPlaceholders } from "./goldParameterHygiene.js";

export interface TranslationBenchGeneratedCase {
    id: string;
    role: "positive" | "negative";
    utterance: string;
    expectedActions: TranslationBenchBenchmarkAction[];
    order: "strict" | "any";
    history?: ChatHistoryInput;
    dimensions: Record<string, string | number | boolean>;
}

export interface TranslationBenchGeneratedCandidate {
    seed: TranslationBenchBenchmarkProbePayload;
    genCases: TranslationBenchGeneratedCase[];
}

const REVIEW_ISSUE_CODES = [
    "ANCHOR_DRIFT",
    "WRONG_ACTION",
    "INVALID_PARAMETERS",
    "AMBIGUOUS_INTENT",
    "DUPLICATE_CASE",
    "WEAK_DIVERSITY",
    "BAD_NEGATIVE",
    "BAD_HISTORY",
    "UNNATURAL_TEXT",
    "OTHER",
] as const;

export type TranslationBenchReviewIssueCode =
    (typeof REVIEW_ISSUE_CODES)[number];

export interface TranslationBenchReviewIssue {
    code: TranslationBenchReviewIssueCode;
    path: string;
    message: string;
    suggestedFix: string;
}

export interface TranslationBenchReviewerScores {
    anchorFidelity: number;
    groundTruthCorrectness: number;
    naturalness: number;
    generalizationDiversity: number;
    negativeQuality: number;
    historyCoherence: number;
}

export interface TranslationBenchReviewerDecision {
    candidateHash: string;
    decision: "approve" | "reject";
    scores: TranslationBenchReviewerScores;
    issues: TranslationBenchReviewIssue[];
    summary: string;
}

const dimensionValueSchema = z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
]);
const actionSchema = z
    .object({
        schemaName: z.string().trim().min(1),
        actionName: z.string().trim().min(1),
        parameters: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();
const probeSchema = z
    .object({
        utterance: z.string().trim().min(1),
        expectedActions: z.array(actionSchema),
        order: z.enum(["strict", "any"]),
        history: z.unknown().optional(),
    })
    .strict();
const generatedCaseSchema = z
    .object({
        id: z.string().trim().min(1),
        role: z.enum(["positive", "negative"]),
        utterance: z.string().trim().min(1),
        expectedActions: z.array(actionSchema),
        order: z.enum(["strict", "any"]),
        history: z.unknown().optional(),
        dimensions: z.record(z.string(), dimensionValueSchema),
    })
    .strict();
const generatedCandidateSchema = z
    .object({
        seed: probeSchema,
        genCases: z.array(generatedCaseSchema),
    })
    .strict();
const reviewIssueSchema = z
    .object({
        code: z.enum(REVIEW_ISSUE_CODES),
        path: z.string().trim().min(1),
        message: z.string().trim().min(1),
        suggestedFix: z.string().trim().min(1),
    })
    .strict();
const reviewerScoresSchema = z
    .object({
        anchorFidelity: z.number().finite().min(0).max(1),
        groundTruthCorrectness: z.number().finite().min(0).max(1),
        naturalness: z.number().finite().min(0).max(1),
        generalizationDiversity: z.number().finite().min(0).max(1),
        negativeQuality: z.number().finite().min(0).max(1),
        historyCoherence: z.number().finite().min(0).max(1),
    })
    .strict();
const reviewerDecisionSchema = z
    .object({
        candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
        decision: z.enum(["approve", "reject"]),
        scores: reviewerScoresSchema,
        issues: z.array(reviewIssueSchema),
        summary: z.string().trim().min(1),
    })
    .strict();

function requirePositiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
}

function normalizedUtterance(value: string): string {
    return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function sameTarget(
    action: TranslationBenchBenchmarkAction,
    target: TranslationBenchTargetAction,
): boolean {
    return (
        action.schemaName === target.schemaName &&
        action.actionName === target.actionName
    );
}

function validateHistory(history: unknown, path: string): void {
    if (history !== undefined && !isChatHistoryInput(history)) {
        throw new Error(`${path} has invalid history`);
    }
}

export function parseTranslationBenchGeneratedCandidate(
    value: unknown,
    context: {
        targetAction: TranslationBenchTargetAction;
        schema: TranslationBenchBenchmarkSchema;
        genCaseCount: number;
        forbiddenUtterances?: ReadonlySet<string>;
        actionShape?: TranslationBenchActionShapePolicy;
    },
): TranslationBenchGeneratedCandidate {
    requirePositiveInteger(
        context.genCaseCount,
        "Translation bench gen-case count",
    );
    if (context.genCaseCount % 2 !== 0) {
        throw new Error("Translation bench gen-case count must be even");
    }
    if (context.schema.schemaName !== context.targetAction.schemaName) {
        throw new Error("Target action does not belong to the supplied schema");
    }
    const parsed = generatedCandidateSchema.parse(
        value,
    ) as TranslationBenchGeneratedCandidate;
    if (parsed.genCases.length !== context.genCaseCount) {
        throw new Error(
            `Generated candidate requires exactly ${context.genCaseCount} gen cases`,
        );
    }
    const definition = fromJSONParsedActionSchema(
        structuredClone(context.schema.typeAgent!.parsedActionSchema),
    ).actionSchemas.get(context.targetAction.actionName);
    if (definition === undefined) {
        throw new Error(
            `Unknown existing TypeAgent action '${context.targetAction.schemaName}.${context.targetAction.actionName}'`,
        );
    }
    const actionShape = normalizeTranslationBenchActionShapePolicy(
        context.actionShape,
    );
    const validatePositive = (
        probe: TranslationBenchBenchmarkProbePayload,
        path: string,
        role: "seed" | "positive",
    ) => {
        assertTranslationBenchExpectedActionArity(
            probe.expectedActions,
            role,
            actionShape,
            path,
        );
        // Simple shape: single scheduled target. Multi will iterate all actions.
        for (const action of probe.expectedActions) {
            if (!sameTarget(action, context.targetAction)) {
                throw new Error(
                    `${path} must contain only the scheduled target action`,
                );
            }
            validateAction(definition, {
                actionName: context.targetAction.actionName,
                ...(action.parameters !== undefined
                    ? { parameters: action.parameters }
                    : {}),
            });
        }
        validateHistory(probe.history, path);
    };
    validatePositive(parsed.seed, "seed", "seed");
    const ids = new Set<string>();
    const seedUtterance = normalizedUtterance(parsed.seed.utterance);
    if (context.forbiddenUtterances?.has(seedUtterance)) {
        throw new Error(
            "seed duplicates an utterance from another generated row",
        );
    }
    const utterances = new Set([seedUtterance]);
    let positives = 0;
    let negatives = 0;
    parsed.genCases.forEach((probe, index) => {
        const path = `genCases[${index}]`;
        if (ids.has(probe.id)) throw new Error(`${path} has a duplicate id`);
        ids.add(probe.id);
        const normalized = normalizedUtterance(probe.utterance);
        if (utterances.has(normalized)) {
            throw new Error(`${path} has a duplicate utterance`);
        }
        if (context.forbiddenUtterances?.has(normalized)) {
            throw new Error(
                `${path} duplicates an utterance from another generated row`,
            );
        }
        utterances.add(normalized);
        validateHistory(probe.history, path);
        if (probe.role === "positive") {
            positives += 1;
            validatePositive(probe, path, "positive");
        } else {
            negatives += 1;
            assertTranslationBenchExpectedActionArity(
                probe.expectedActions,
                "negative",
                actionShape,
                path,
            );
        }
    });
    const expectedPerRole = context.genCaseCount / 2;
    if (positives !== expectedPerRole || negatives !== expectedPerRole) {
        throw new Error(
            `Generated candidate requires ${expectedPerRole} positive and ${expectedPerRole} negative gen cases`,
        );
    }
    // Gold hygiene: drop empty "" / [] / null placeholders from labeled params.
    return stripEmptyGoldPlaceholdersFromCandidate(structuredClone(parsed));
}

function stripEmptyGoldPlaceholdersFromActions(
    actions: TranslationBenchBenchmarkAction[],
): TranslationBenchBenchmarkAction[] {
    return actions.map((action) => {
        const { parameters } = stripEmptyGoldPlaceholders(action.parameters);
        if (parameters === action.parameters) {
            return action;
        }
        if (parameters === undefined) {
            const { parameters: _drop, ...rest } = action;
            return rest;
        }
        return { ...action, parameters };
    });
}

/** Deterministic gold cleanup shared by parse + format checker. */
export function stripEmptyGoldPlaceholdersFromCandidate(
    candidate: TranslationBenchGeneratedCandidate,
): TranslationBenchGeneratedCandidate {
    return {
        ...candidate,
        seed: {
            ...candidate.seed,
            expectedActions: stripEmptyGoldPlaceholdersFromActions(
                candidate.seed.expectedActions,
            ),
        },
        genCases: candidate.genCases.map((probe) => {
            if (probe.role !== "positive") {
                return probe;
            }
            return {
                ...probe,
                expectedActions: stripEmptyGoldPlaceholdersFromActions(
                    probe.expectedActions,
                ),
            };
        }),
    };
}

export function parseTranslationBenchReviewerDecision(
    value: unknown,
    candidateHash: string,
    // Optional floor; pack threshold is applied later by the quality verifier.
    approveScoreThreshold?: number,
): TranslationBenchReviewerDecision {
    const decision = reviewerDecisionSchema.parse(
        value,
    ) as TranslationBenchReviewerDecision;
    if (decision.candidateHash !== candidateHash) {
        throw new Error(
            "Reviewer candidate hash does not match the reviewed candidate",
        );
    }
    if (decision.decision === "approve") {
        if (decision.issues.length !== 0) {
            throw new Error("Reviewer approval must not contain issues");
        }
        if (approveScoreThreshold !== undefined) {
            const belowThreshold = Object.entries(decision.scores).find(
                ([, score]) => score < approveScoreThreshold,
            );
            if (belowThreshold !== undefined) {
                throw new Error(
                    `Reviewer approval score '${belowThreshold[0]}' is below ${approveScoreThreshold}`,
                );
            }
        }
    } else if (decision.issues.length === 0) {
        throw new Error("Reviewer rejection must contain actionable issues");
    }
    return structuredClone(decision);
}
