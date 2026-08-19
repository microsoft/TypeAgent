// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import * as fs from "node:fs";

import { fromJSONParsedActionSchema } from "@typeagent/action-schema";
import type { CompletionJsonSchema } from "@typeagent/aiclient";

import {
    computeTranslationBenchCanonicalPayloadHash,
    computeTranslationBenchCanonicalJsonHash,
    computeTranslationBenchSourceManifestHash,
    createTranslationBenchTypeAgentSchemaCatalog,
    parseTranslationBenchDatasetBuilderJson,
    translationBenchCaseRecordSchemas,
    validateTranslationBenchBenchmark,
    type TranslationBenchBenchmark,
    type TranslationBenchBenchmarkCaseRecord,
    type TranslationBenchBenchmarkPricing,
    type TranslationBenchBenchmarkProbePayload,
    type TranslationBenchBenchmarkSchema,
    type TranslationBenchBuilderDecisionLedgerEntry,
    type TranslationBenchBuilderUsage,
    type TranslationBenchDatasetBuilderCompletion,
    type TranslationBenchGeneratedAttempt,
    type TranslationBenchGeneratedCaseProvenance,
    type TranslationBenchGenerationContractVersion,
    type TranslationBenchPublicProbe,
    type TranslationBenchTargetAction,
} from "./benchmark.js";
import { parseVersionedWithZod } from "./zodJson.js";
import type { ActionConfigProvider } from "agent-dispatcher/internal";
import {
    assertTranslationBenchSourceManifest,
    importTranslationBenchSourceCandidates,
    type TranslationBenchSourceCandidate,
    type TranslationBenchSourceManifest,
} from "./sourceBuilder.js";
import {
    translationBenchResumeKey,
    appendTranslationBenchCheckpointRows,
    createTranslationBenchRunFingerprint,
    getTranslationBenchCatalogCensus,
    readTranslationBenchCheckpoint,
    type TranslationBenchCheckpointHeader,
    type TranslationBenchCheckpointRow,
} from "./generationSupport.js";
import {
    type TranslationBenchGeneratedCandidate,
    type TranslationBenchReviewIssue,
} from "./generationCandidate.js";
import {
    runTranslationBenchDataQualityVerifier,
    runTranslationBenchFormatChecker,
} from "./dataQualityVerifier.js";
import {
    loadTranslationBenchQualityVerifierPromptPack,
    loadTranslationBenchSynthesizerPromptPack,
    renderTranslationBenchPromptTemplate,
    toTranslationBenchPromptYaml,
    type TranslationBenchSynthesizerPromptPack,
} from "./synthesizerPrompts.js";
import {
    findTranslationBenchConfusableSiblings,
    summarizeTranslationBenchConfusableSiblings,
} from "./utteranceDisambiguation.js";
import {
    clearPackagedLlmJudgeExcludedActionsCacheForTests,
    countEligibleTranslationBenchActions,
    getPackagedLlmJudgeExcludedActions,
} from "./eligibleActions.js";
import {
    getPackagedActionParametersGraderCatalog,
    hasUsableParameterScoreSpecs,
    parameterScoreSpecsForExpectedActions,
} from "./catalogGenerator/actionParametersGrader.js";

export function getTranslationBenchLlmJudgeExcludedActions(): ReadonlySet<string> {
    return getPackagedLlmJudgeExcludedActions();
}

export function clearTranslationBenchLlmJudgeExcludedActionsCacheForTests(): void {
    clearPackagedLlmJudgeExcludedActionsCacheForTests();
}

export {
    parseTranslationBenchGeneratedCandidate,
    parseTranslationBenchReviewerDecision,
    type TranslationBenchGeneratedCandidate,
    type TranslationBenchGeneratedCase,
    type TranslationBenchReviewIssue,
    type TranslationBenchReviewIssueCode,
    type TranslationBenchReviewerDecision,
    type TranslationBenchReviewerScores,
} from "./generationCandidate.js";

export interface TranslationBenchGenerationLlm {
    model: string;
    complete(
        prompt: string,
        jsonSchema?: CompletionJsonSchema,
    ): Promise<string | TranslationBenchDatasetBuilderCompletion>;
}

export interface TranslationBenchGenerationScheduleEntry {
    slot: number;
    schemaName: string;
    actionName: string;
}

export interface TranslationBenchGenerationCoverage {
    schemaCount: number;
    actionCount: number;
    scheduledActionCount: number;
    complete: boolean;
    catalogDigest: string;
}

export interface TranslationBenchGenerationSchedule {
    entries: TranslationBenchGenerationScheduleEntry[];
    coverage: TranslationBenchGenerationCoverage;
}

const TRANSLATION_BENCH_GENERATION_CONTRACT_VERSION =
    2 satisfies TranslationBenchGenerationContractVersion;

export interface TranslationBenchAcceptedGeneration {
    candidate: TranslationBenchGeneratedCandidate;
    candidateHash: string;
    acceptedAttempt: number;
    attempts: TranslationBenchGeneratedAttempt[];
}

export interface TranslationBenchGenerationQualityLoopOptions {
    targetAction: TranslationBenchTargetAction;
    schema: TranslationBenchBenchmarkSchema;
    /** Full catalog used for confusable-sibling disambiguation (defaults to [schema]). */
    catalogSchemas?: readonly TranslationBenchBenchmarkSchema[];
    anchor: TranslationBenchSourceCandidate;
    activeSchemas: string[];
    genCaseCount: number;
    maxAttempts: number;
    generator: TranslationBenchGenerationLlm;
    reviewer: TranslationBenchGenerationLlm;
    forbiddenUtterances?: ReadonlySet<string>;
    promptsDir?: string;
}

// Checkpoint settings fingerprint for a generation run.
export interface TranslationBenchGenerationCheckpointSettings {
    kind: "translation-bench-generation";
    contractVersion: TranslationBenchGenerationContractVersion;
    sourceManifestHash: string;
    catalogDigest: string;
    catalogSchemaHashes: Record<string, string>;
    caseCount: number;
    genCaseCount: number;
    maxAttempts: number;
    requireCompleteCoverage: boolean;
    generatorModel: string;
    reviewerModel: string;
    schedule: TranslationBenchGenerationScheduleEntry[];
    synthesizerPromptHash: string;
    qualityVerifierPromptHash: string;
}

export type TranslationBenchSynthesizerLlm = TranslationBenchGenerationLlm;
export type TranslationBenchSynthesizerLoopOptions =
    TranslationBenchGenerationQualityLoopOptions;

export interface TranslationBenchGeneratedBenchmarkOptions {
    name: string;
    sourceText: string;
    sourceManifest: TranslationBenchSourceManifest;
    provider: ActionConfigProvider;
    caseCount: number;
    genCaseCount: number;
    maxAttempts: number;
    requireCompleteCoverage: boolean;
    /** Parallel schedule slots (default 1). Checkpoint commits stay serialized. */
    concurrency?: number;
    generator: TranslationBenchGenerationLlm;
    reviewer: TranslationBenchGenerationLlm;
    checkpointPath?: string;
    resume?: boolean;
    promptsDir?: string;
    pricing?: Record<string, TranslationBenchBenchmarkPricing>;
    onProgress?: (completed: number, total: number) => void;
}

export interface TranslationBenchGeneratedBenchmarkResult {
    benchmark: TranslationBenchBenchmark;
    coverage: TranslationBenchGenerationCoverage;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
    ) {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("Cannot hash non-finite JSON");
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
    }
    if (typeof value !== "object")
        throw new Error("Cannot hash non-JSON value");
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort(compareText)
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(",")}}`;
}

function hashText(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown): string {
    return hashText(canonicalJson(value));
}

function normalizedUtterance(value: string): string {
    return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function requirePositiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
}

export function createTranslationBenchGenerationSchedule(
    catalog: TranslationBenchBenchmarkSchema[],
    options: {
        caseCount: number;
        requireCompleteCoverage: boolean;
        excludedActionIds?: ReadonlySet<string>;
    },
): TranslationBenchGenerationSchedule {
    requirePositiveInteger(options.caseCount, "Translation bench case count");
    const census = getTranslationBenchCatalogCensus(catalog);
    const excludedActionIds =
        options.excludedActionIds ?? getPackagedLlmJudgeExcludedActions();
    const qualified = census.qualifiedActionKeys
        .map((key) => {
            const [schemaName, actionName] = JSON.parse(key) as [
                string,
                string,
            ];
            return { schemaName, actionName };
        })
        .filter(
            (action) =>
                !excludedActionIds.has(
                    `${action.schemaName}.${action.actionName}`,
                ),
        );
    const eligibleActionCount = countEligibleTranslationBenchActions(
        catalog,
        excludedActionIds,
    );
    if (eligibleActionCount === 0 || qualified.length === 0) {
        throw new Error(
            "Translation bench generation schedule has no eligible actions after llmAsAJudge exclusions",
        );
    }
    if (
        options.requireCompleteCoverage &&
        options.caseCount < eligibleActionCount
    ) {
        throw new Error(
            `Complete action coverage requires at least ${eligibleActionCount} cases; requested ${options.caseCount}`,
        );
    }
    const selected =
        options.caseCount >= qualified.length
            ? Array.from({ length: options.caseCount }, (_, slot) => ({
                  slot,
                  ...qualified[slot % qualified.length]!,
              }))
            : schemaBalancedSample(qualified, options.caseCount).map(
                  (target, slot) => ({ slot, ...target }),
              );
    const scheduledActionCount = new Set(
        selected.map((entry) => `${entry.schemaName}\u0000${entry.actionName}`),
    ).size;
    return {
        entries: selected,
        coverage: {
            schemaCount: census.schemaCount,
            actionCount: census.actionCount,
            scheduledActionCount,
            complete: scheduledActionCount === eligibleActionCount,
            catalogDigest: census.catalogDigest,
        },
    };
}

function schemaBalancedSample(
    actions: Array<{ schemaName: string; actionName: string }>,
    count: number,
): Array<{ schemaName: string; actionName: string }> {
    const bySchema = new Map<
        string,
        Array<{ schemaName: string; actionName: string }>
    >();
    for (const action of actions) {
        const entries = bySchema.get(action.schemaName) ?? [];
        entries.push(action);
        bySchema.set(action.schemaName, entries);
    }
    const schemas = [...bySchema.keys()].sort(compareText);
    const output: Array<{ schemaName: string; actionName: string }> = [];
    for (let depth = 0; output.length < count; depth += 1) {
        let added = false;
        for (const schemaName of schemas) {
            const action = bySchema.get(schemaName)![depth];
            if (action === undefined) continue;
            output.push(action);
            added = true;
            if (output.length === count) break;
        }
        if (!added) break;
    }
    return output;
}

function completionValue(
    result: string | TranslationBenchDatasetBuilderCompletion,
): TranslationBenchDatasetBuilderCompletion {
    return typeof result === "string" ? { text: result } : result;
}

function completionRecord(
    completion: TranslationBenchDatasetBuilderCompletion,
    model: string,
    promptHash: string,
): TranslationBenchGeneratedAttempt["generator"] {
    return {
        model,
        promptHash,
        responseHash: hashText(completion.text),
        ...(completion.usage !== undefined
            ? { usage: structuredClone(completion.usage) }
            : {}),
        ...(completion.estimatedCostUsd !== undefined
            ? { estimatedCostUsd: completion.estimatedCostUsd }
            : {}),
        ...(completion.pricing !== undefined
            ? { pricing: structuredClone(completion.pricing) }
            : {}),
    };
}

function targetParameterField(
    options: TranslationBenchGenerationQualityLoopOptions,
) {
    const definition = fromJSONParsedActionSchema(
        structuredClone(options.schema.typeAgent!.parsedActionSchema),
    ).actionSchemas.get(options.targetAction.actionName);
    if (definition === undefined) {
        throw new Error(
            `Unknown existing TypeAgent action '${options.targetAction.schemaName}.${options.targetAction.actionName}'`,
        );
    }
    return definition.type.fields.parameters;
}

function generationHistoryJsonSchema() {
    return {
        type: "array",
        minItems: 1,
        items: {
            type: "object",
            properties: {
                user: { type: "string", minLength: 1 },
                assistant: {
                    type: "object",
                    properties: {
                        text: { type: "string", minLength: 1 },
                        source: { type: "string", minLength: 1 },
                    },
                    required: ["text", "source"],
                    additionalProperties: false,
                },
            },
            required: ["user", "assistant"],
            additionalProperties: false,
        },
    };
}

function generationJsonSchema(
    options: TranslationBenchGenerationQualityLoopOptions,
): CompletionJsonSchema {
    const targetTool = options.schema.tools.find(
        (tool) => tool.function.name === options.targetAction.actionName,
    )!;
    const parameterField = targetParameterField(options);
    const actionRequired = ["schemaName", "actionName"];
    if (parameterField !== undefined && !parameterField.optional) {
        actionRequired.push("parameters");
    }
    const action = {
        type: "object",
        properties: {
            schemaName: { const: options.targetAction.schemaName },
            actionName: { const: options.targetAction.actionName },
            ...(parameterField !== undefined
                ? {
                      parameters: structuredClone(
                          targetTool.function.parameters,
                      ),
                  }
                : {}),
        },
        required: actionRequired,
        additionalProperties: false,
    };
    const probeProperties = {
        utterance: { type: "string", minLength: 1 },
        expectedActions: {
            type: "array",
            items: action,
            minItems: 0,
            maxItems: 1,
        },
        order: { type: "string", enum: ["strict", "any"] },
        history: generationHistoryJsonSchema(),
    };
    return {
        name: "translation_bench_generated_row",
        description:
            "One seed and its positive and negative generalization cases",
        schema: {
            type: "object",
            properties: {
                seed: {
                    type: "object",
                    properties: probeProperties,
                    required: ["utterance", "expectedActions", "order"],
                    additionalProperties: false,
                },
                genCases: {
                    type: "array",
                    minItems: options.genCaseCount,
                    maxItems: options.genCaseCount,
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string", minLength: 1 },
                            role: {
                                type: "string",
                                enum: ["positive", "negative"],
                            },
                            ...probeProperties,
                            dimensions: {
                                type: "object",
                                additionalProperties: {
                                    anyOf: [
                                        { type: "string" },
                                        { type: "number" },
                                        { type: "boolean" },
                                    ],
                                },
                            },
                        },
                        required: [
                            "id",
                            "role",
                            "utterance",
                            "expectedActions",
                            "order",
                            "dimensions",
                        ],
                        additionalProperties: false,
                    },
                },
            },
            required: ["seed", "genCases"],
            additionalProperties: false,
        },
    };
}

function formatSynthesizerPrompt(
    options: TranslationBenchGenerationQualityLoopOptions,
    feedback: TranslationBenchReviewIssue[],
    attempt: number,
    previousRejectedCandidate: TranslationBenchGeneratedCandidate | undefined,
    pack: TranslationBenchSynthesizerPromptPack,
): string {
    const targetTool = options.schema.tools.find(
        (tool) => tool.function.name === options.targetAction.actionName,
    )!;
    const parameterField = targetParameterField(options);
    const actionContract =
        parameterField === undefined
            ? `Every expected action must use exactly {"schemaName":"${options.targetAction.schemaName}","actionName":"${options.targetAction.actionName}"}; omit parameters entirely for this parameterless action. Never use name/arguments or a qualified-name string.`
            : `Every expected action must use exactly {"schemaName":"${options.targetAction.schemaName}","actionName":"${options.targetAction.actionName}","parameters":{...}} with schema-valid parameters${parameterField.optional ? " when parameters are present" : ""}. Never use name/arguments or a qualified-name string. Only include parameters clearly supported by the utterance (or allowed history); omit optional defaults, empty strings/arrays, dual fields, and invented runtime context.`;
    const positiveCount = options.genCaseCount / 2;
    const previousRejectedBlock =
        previousRejectedCandidate === undefined
            ? "Previous rejected candidate: (none)"
            : `Previous rejected candidate (JSON):\n${JSON.stringify(previousRejectedCandidate)}`;
    const catalog = options.catalogSchemas ?? [options.schema];
    const confusableSiblings = findTranslationBenchConfusableSiblings(
        options.targetAction,
        catalog,
    );
    return renderTranslationBenchPromptTemplate(pack.template, {
        action_contract: actionContract,
        gen_case_count: options.genCaseCount,
        positive_count: positiveCount,
        negative_count: positiveCount,
        attempt,
        immutable_context_yaml: toTranslationBenchPromptYaml({
            anchor: {
                candidateId: options.anchor.candidateId,
                utterance: options.anchor.utterance,
                ...(options.anchor.history !== undefined
                    ? { history: options.anchor.history }
                    : {}),
                sourceCalls: options.anchor.sourceCalls,
                dimensions: options.anchor.dimensions,
            },
            targetAction: options.targetAction,
            targetTool,
            schemaDescription: options.schema.description,
            activeSchemas: options.activeSchemas,
            confusableSiblings: summarizeTranslationBenchConfusableSiblings(
                options.targetAction,
                confusableSiblings,
            ),
            disambiguationRule:
                "Every seed and positive utterance must uniquely identify the target action. If confusableSiblings is non-empty, include target-only cues and never use phrasing that fits a sibling equally well.",
        }),
        prior_feedback_json: JSON.stringify(feedback),
        previous_rejected_block: previousRejectedBlock,
    });
}

function validationIssue(error: unknown): TranslationBenchReviewIssue {
    return {
        code: "INVALID_PARAMETERS",
        path: "$",
        message: error instanceof Error ? error.message : String(error),
        suggestedFix:
            "Regenerate the complete row and satisfy every deterministic schema and count invariant.",
    };
}

export async function runTranslationBenchGenerationQualityLoop(
    options: TranslationBenchGenerationQualityLoopOptions,
): Promise<TranslationBenchAcceptedGeneration> {
    requirePositiveInteger(
        options.maxAttempts,
        "Translation bench maximum attempts",
    );
    requirePositiveInteger(
        options.genCaseCount,
        "Translation bench gen-case count",
    );
    if (options.genCaseCount % 2 !== 0) {
        throw new Error("Translation bench gen-case count must be even");
    }
    if (options.maxAttempts > 5) {
        throw new Error("Translation bench maximum attempts must not exceed 5");
    }
    if (!options.generator.model.trim() || !options.reviewer.model.trim()) {
        throw new Error(
            "Synthesizer (labeler) and quality-verifier models are required",
        );
    }
    const synthesizerPack = loadTranslationBenchSynthesizerPromptPack(
        options.promptsDir,
    );
    const attempts: TranslationBenchGeneratedAttempt[] = [];
    let feedback: TranslationBenchReviewIssue[] = [];
    let previousRejectedCandidate:
        | TranslationBenchGeneratedCandidate
        | undefined;
    for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
        const generatorPrompt = formatSynthesizerPrompt(
            options,
            feedback,
            attempt,
            previousRejectedCandidate,
            synthesizerPack,
        );
        const generatorCompletion = completionValue(
            await options.generator.complete(
                generatorPrompt,
                generationJsonSchema(options),
            ),
        );
        const record: TranslationBenchGeneratedAttempt = {
            attempt,
            generator: completionRecord(
                generatorCompletion,
                options.generator.model,
                hashText(generatorPrompt),
            ),
            validationIssues: [],
        };
        attempts.push(record);

        let synthesizerJson: unknown;
        try {
            synthesizerJson = parseTranslationBenchDatasetBuilderJson(
                generatorCompletion.text,
                "Translation-bench synthesizer (data labeler)",
            );
        } catch (error) {
            feedback = [validationIssue(error)];
            record.validationIssues = feedback;
            continue;
        }

        // Stage 1 — format checker (deterministic). No LLM.
        const format = runTranslationBenchFormatChecker(
            synthesizerJson,
            options,
        );
        if (!format.passed || format.candidate === undefined) {
            feedback = format.issues;
            record.validationIssues = feedback;
            continue;
        }
        const candidate = format.candidate;
        const candidateHash =
            computeTranslationBenchCanonicalJsonHash(candidate);

        // Stage 2 — full quality verifier ending in semantic checker (LLM).
        const verify = await runTranslationBenchDataQualityVerifier({
            synthesizerOutput: synthesizerJson,
            loop: options,
            candidateHash,
            candidate,
            semanticLlm: options.reviewer,
            ...(options.promptsDir !== undefined
                ? { promptsDir: options.promptsDir }
                : {}),
        });

        if (!verify.format.passed || verify.format.candidate === undefined) {
            feedback = verify.feedback;
            record.validationIssues = feedback;
            previousRejectedCandidate = candidate;
            continue;
        }

        // Semantic is required; missing semantic is a hard reject (not accept).
        if (verify.semantic === undefined) {
            feedback =
                verify.feedback.length > 0
                    ? verify.feedback
                    : [
                          {
                              code: "OTHER",
                              path: "$",
                              message:
                                  "quality verifier did not produce a semantic decision",
                              suggestedFix:
                                  "Ensure the reviewer returns valid approve/reject JSON",
                          },
                      ];
            record.validationIssues = feedback;
            previousRejectedCandidate = candidate;
            continue;
        }

        const semantic = verify.semantic;
        const reviewerRecord = completionRecord(
            {
                text: semantic.completionText,
            },
            options.reviewer.model,
            hashText(semantic.prompt),
        );
        record.reviewer = {
            ...reviewerRecord,
            candidateHash,
            decision: semantic.decision.decision,
            scores: semantic.decision.scores,
            issues: semantic.decision.issues,
            summary: semantic.decision.summary,
        };

        if (verify.accepted && semantic.decision.decision === "approve") {
            return {
                candidate: verify.format.candidate,
                candidateHash,
                acceptedAttempt: attempt,
                attempts,
            };
        }
        feedback = verify.feedback;
        previousRejectedCandidate = candidate;
    }
    throw new Error(
        `Translation-bench synthesizer row failed data-quality verification after ${options.maxAttempts} attempts: ${feedback.map((issue) => issue.message).join("; ")}`,
    );
}

export const runTranslationBenchSynthesizerQualityLoop =
    runTranslationBenchGenerationQualityLoop;

function generatedLineage(
    anchor: TranslationBenchSourceCandidate,
    payload: TranslationBenchBenchmarkProbePayload,
    catalog: TranslationBenchBenchmarkSchema[],
    activeSchemas: string[],
) {
    return {
        ...structuredClone(anchor.lineage),
        canonicalPayloadHash: computeTranslationBenchCanonicalPayloadHash(
            payload,
            catalog,
            activeSchemas,
            true,
        ),
        transformVersion: 2 as const,
    };
}

export function finalizeTranslationBenchGeneratedCaseLineage(
    evalCase: TranslationBenchBenchmarkCaseRecord,
    catalog: TranslationBenchBenchmarkSchema[],
): TranslationBenchBenchmarkCaseRecord {
    const finalized = structuredClone(evalCase);
    const grader = getPackagedActionParametersGraderCatalog();
    for (const probe of [finalized.seed, ...finalized.generalizations]) {
        // Generated probes always use transform v2 + canonical payload hash.
        probe.lineage.transformVersion = 2 as const;
        probe.lineage.canonicalPayloadHash =
            computeTranslationBenchCanonicalPayloadHash(
                probe,
                catalog,
                finalized.activeSchemas,
                true,
            );
        // Attach deterministic soft-match specs so the runner does not exact-
        // match free-text params (e.g. originalRequest). Derived from the
        // packaged grader; excluded from the canonical payload hash above.
        const specs = parameterScoreSpecsForExpectedActions(
            grader,
            probe.expectedActions,
        );
        if (hasUsableParameterScoreSpecs(specs)) {
            probe.parameterScore = specs;
        } else {
            delete probe.parameterScore;
        }
    }
    return finalized;
}

function acceptedToCase(
    entry: TranslationBenchGenerationScheduleEntry,
    anchor: TranslationBenchSourceCandidate,
    accepted: TranslationBenchAcceptedGeneration,
    catalog: TranslationBenchBenchmarkSchema[],
    activeSchemas: string[],
    generatorModel: string,
    reviewerModel: string,
): TranslationBenchBenchmarkCaseRecord {
    const targetAction = {
        schemaName: entry.schemaName,
        actionName: entry.actionName,
    };
    const toProbe = (
        payload: TranslationBenchBenchmarkProbePayload,
        role: "seed" | "positive" | "negative",
        dimensions: Record<string, string | number | boolean>,
        rationale: string,
    ): TranslationBenchPublicProbe => ({
        ...structuredClone(payload),
        lineage: generatedLineage(anchor, payload, catalog, activeSchemas),
        selection: {
            role,
            targetAction,
            dimensions,
            rationale,
            confidence: Math.min(
                accepted.attempts.at(-1)!.reviewer!.scores.anchorFidelity,
                accepted.attempts.at(-1)!.reviewer!.scores
                    .groundTruthCorrectness,
                accepted.attempts.at(-1)!.reviewer!.scores.naturalness,
                accepted.attempts.at(-1)!.reviewer!.scores
                    .generalizationDiversity,
                accepted.attempts.at(-1)!.reviewer!.scores.negativeQuality,
                accepted.attempts.at(-1)!.reviewer!.scores.historyCoherence,
            ),
        },
    });
    const provenance: TranslationBenchGeneratedCaseProvenance = {
        origin: "llm-derived",
        anchorCandidateId: anchor.candidateId,
        generatorModel,
        reviewerModel,
        acceptedAttempt: accepted.acceptedAttempt,
        candidateHash: accepted.candidateHash,
        genCaseIds: accepted.candidate.genCases.map((probe) => probe.id),
        attempts: structuredClone(accepted.attempts),
    };
    return {
        recordType: "case",
        version: 1,
        id: `generated-${String(entry.slot).padStart(6, "0")}-${entry.schemaName}-${entry.actionName}`,
        activeSchemas: structuredClone(activeSchemas),
        targetAction,
        explainer: { valueInRequest: true, noReferences: true },
        seed: toProbe(
            accepted.candidate.seed,
            "seed",
            { origin: "llm-derived", slot: entry.slot },
            `Synthetic seed derived from pinned source anchor ${anchor.candidateId}`,
        ),
        generalizations: accepted.candidate.genCases.map((probe) =>
            toProbe(
                {
                    utterance: probe.utterance,
                    expectedActions: probe.expectedActions,
                    order: probe.order,
                    ...(probe.history !== undefined
                        ? { history: probe.history }
                        : {}),
                },
                probe.role,
                probe.dimensions,
                `Quality-reviewed ${probe.role} generated case`,
            ),
        ),
        dimensions: {
            origin: "llm-derived",
            slot: entry.slot,
            anchorCategory: String(anchor.dimensions.category ?? ""),
        },
        generation: provenance,
    };
}

function aggregateUsage(
    cases: TranslationBenchBenchmarkCaseRecord[],
): TranslationBenchBuilderUsage | undefined {
    const records = cases.flatMap(
        (evalCase) =>
            evalCase.generation?.attempts.flatMap((attempt) => [
                attempt.generator,
                ...(attempt.reviewer === undefined ? [] : [attempt.reviewer]),
            ]) ?? [],
    );
    if (
        records.length === 0 ||
        records.some((record) => record.usage === undefined)
    ) {
        return undefined;
    }
    const usage = records.map((record) => record.usage!);
    return {
        promptTokens: usage.reduce((sum, item) => sum + item.promptTokens, 0),
        completionTokens: usage.reduce(
            (sum, item) => sum + item.completionTokens,
            0,
        ),
        ...(usage.every((item) => item.cachedTokens !== undefined)
            ? {
                  cachedTokens: usage.reduce(
                      (sum, item) => sum + item.cachedTokens!,
                      0,
                  ),
              }
            : {}),
        ...(usage.every((item) => item.reasoningTokens !== undefined)
            ? {
                  reasoningTokens: usage.reduce(
                      (sum, item) => sum + item.reasoningTokens!,
                      0,
                  ),
              }
            : {}),
    };
}

function decisionLedger(
    cases: TranslationBenchBenchmarkCaseRecord[],
): TranslationBenchBuilderDecisionLedgerEntry[] {
    return cases.flatMap((evalCase) =>
        [evalCase.seed, ...evalCase.generalizations].map((probe, index) => {
            const { canonicalPayloadHash: _canonicalPayloadHash, ...lineage } =
                probe.lineage;
            return {
                decision: "score" as const,
                candidateId: `${evalCase.id}:${index === 0 ? "seed" : `gen-${index}`}`,
                lineage,
                bankId: evalCase.id,
                role: probe.selection.role,
                targetAction: structuredClone(evalCase.targetAction),
                rationale: probe.selection.rationale,
                confidence: probe.selection.confidence,
            };
        }),
    );
}

function checkpointHeader(
    options: TranslationBenchGeneratedBenchmarkOptions,
    catalog: TranslationBenchBenchmarkSchema[],
    schedule: TranslationBenchGenerationSchedule,
): TranslationBenchCheckpointHeader {
    const synthesizerPack = loadTranslationBenchSynthesizerPromptPack(
        options.promptsDir,
    );
    const qualityPack = loadTranslationBenchQualityVerifierPromptPack(
        options.promptsDir,
    );
    const settings: TranslationBenchGenerationCheckpointSettings = {
        kind: "translation-bench-generation",
        contractVersion: TRANSLATION_BENCH_GENERATION_CONTRACT_VERSION,
        sourceManifestHash: computeTranslationBenchSourceManifestHash(
            options.sourceManifest,
        ),
        catalogDigest: schedule.coverage.catalogDigest,
        catalogSchemaHashes: Object.fromEntries(
            catalog.map((schema) => [
                schema.schemaName,
                schema.typeAgent!.sourceHash,
            ]),
        ),
        caseCount: options.caseCount,
        genCaseCount: options.genCaseCount,
        maxAttempts: options.maxAttempts,
        requireCompleteCoverage: options.requireCompleteCoverage,
        generatorModel: options.generator.model,
        reviewerModel: options.reviewer.model,
        schedule: schedule.entries,
        // Pin packs so resume cannot mix labeler/verifier policies.
        synthesizerPromptHash: hashJson({
            name: synthesizerPack.name,
            version: synthesizerPack.version,
            role: synthesizerPack.role,
            template: synthesizerPack.template,
            modelConfiguration: synthesizerPack.modelConfiguration,
        }),
        qualityVerifierPromptHash: hashJson({
            name: qualityPack.name,
            version: qualityPack.version,
            role: qualityPack.role,
            formatChecker: qualityPack.formatChecker,
            semanticChecker: qualityPack.semanticChecker,
            acceptance: qualityPack.acceptance,
        }),
    };
    return {
        kind: "translation-bench-checkpoint",
        version: 1,
        runFingerprint: createTranslationBenchRunFingerprint(settings),
        settings,
        shardIndex: 0,
        shardCount: 1,
    };
}

function generationCheckpointSettings(
    settings: unknown,
): TranslationBenchGenerationCheckpointSettings {
    const value = settings as TranslationBenchGenerationCheckpointSettings;
    if (
        value?.kind !== "translation-bench-generation" ||
        typeof value.generatorModel !== "string" ||
        typeof value.reviewerModel !== "string"
    ) {
        throw new Error(
            "Translation bench generation checkpoint settings are invalid",
        );
    }
    return value;
}

function checkpointIdentity(
    entry: TranslationBenchGenerationScheduleEntry,
    generatorModel: string,
    reviewerModel: string,
) {
    return {
        phase: "generation",
        model: `${generatorModel}|${reviewerModel}`,
        scenario: "reviewed",
        caseId: `slot-${entry.slot}`,
    };
}

function loadCheckpointCases(
    checkpointPath: string,
    header: TranslationBenchCheckpointHeader,
    schedule: TranslationBenchGenerationScheduleEntry[],
): Map<number, TranslationBenchBenchmarkCaseRecord> {
    const checkpoint =
        readTranslationBenchCheckpoint<TranslationBenchBenchmarkCaseRecord>(
            checkpointPath,
        );
    if (
        checkpoint.header.runFingerprint !== header.runFingerprint ||
        canonicalJson(checkpoint.header.settings) !==
            canonicalJson(header.settings)
    ) {
        throw new Error(
            "Translation bench generation checkpoint is incompatible",
        );
    }
    const settings = generationCheckpointSettings(header.settings);
    const bySlot = new Map<number, TranslationBenchBenchmarkCaseRecord>();
    for (const row of checkpoint.rows) {
        const entry = schedule.find(
            (candidate) =>
                translationBenchResumeKey(
                    checkpointIdentity(
                        candidate,
                        settings.generatorModel,
                        settings.reviewerModel,
                    ),
                ) === translationBenchResumeKey(row),
        );
        if (entry === undefined || bySlot.has(entry.slot)) {
            throw new Error(
                "Translation bench generation checkpoint has unexpected work",
            );
        }
        const evalCase = parseVersionedWithZod(
            row.value,
            translationBenchCaseRecordSchemas,
            `checkpoint case slot-${entry.slot}`,
        ) as TranslationBenchBenchmarkCaseRecord;
        if (
            evalCase.targetAction.schemaName !== entry.schemaName ||
            evalCase.targetAction.actionName !== entry.actionName ||
            evalCase.id !==
                `generated-${String(entry.slot).padStart(6, "0")}-${entry.schemaName}-${entry.actionName}`
        ) {
            throw new Error(
                "Translation bench generation checkpoint target does not match its schedule",
            );
        }
        bySlot.set(entry.slot, evalCase);
    }
    return bySlot;
}

export async function generateTranslationBenchBenchmark(
    options: TranslationBenchGeneratedBenchmarkOptions,
): Promise<TranslationBenchGeneratedBenchmarkResult> {
    assertTranslationBenchSourceManifest(options.sourceManifest);
    requirePositiveInteger(options.caseCount, "Translation bench case count");
    requirePositiveInteger(
        options.genCaseCount,
        "Translation bench gen-case count",
    );
    requirePositiveInteger(
        options.maxAttempts,
        "Translation bench maximum attempts",
    );
    if (options.genCaseCount % 2 !== 0) {
        throw new Error("Translation bench gen-case count must be even");
    }
    if (options.maxAttempts > 5) {
        throw new Error("Translation bench maximum attempts must not exceed 5");
    }
    const catalog = createTranslationBenchTypeAgentSchemaCatalog(
        options.provider,
    );
    const schedule = createTranslationBenchGenerationSchedule(catalog, {
        caseCount: options.caseCount,
        requireCompleteCoverage: options.requireCompleteCoverage,
    });
    const seenAnchors = new Set<string>();
    const anchors = importTranslationBenchSourceCandidates(options.sourceText, {
        manifest: options.sourceManifest,
        skipInvalidRows: true,
    }).filter((candidate) => {
        if (seenAnchors.has(candidate.candidateId)) return false;
        seenAnchors.add(candidate.candidateId);
        return true;
    });
    if (anchors.length < options.caseCount) {
        throw new Error(
            `Pinned source has ${anchors.length} eligible anchors; ${options.caseCount} unique anchors are required`,
        );
    }
    const schemas = new Map(
        catalog.map((schema) => [schema.schemaName, schema]),
    );
    const activeSchemas = catalog.map((schema) => schema.schemaName);
    const header = checkpointHeader(options, catalog, schedule);
    const casesBySlot = new Map<number, TranslationBenchBenchmarkCaseRecord>();
    if (
        options.checkpointPath !== undefined &&
        fs.existsSync(options.checkpointPath)
    ) {
        if (!options.resume) {
            throw new Error(
                "Translation bench generation checkpoint already exists; use --resume or a fresh path",
            );
        }
        for (const [slot, evalCase] of loadCheckpointCases(
            options.checkpointPath,
            header,
            schedule.entries,
        )) {
            casesBySlot.set(slot, evalCase);
        }
    }
    const usedUtterances = new Set<string>();
    for (const evalCase of casesBySlot.values()) {
        for (const probe of [evalCase.seed, ...evalCase.generalizations]) {
            const normalized = normalizedUtterance(probe.utterance);
            if (usedUtterances.has(normalized)) {
                throw new Error(
                    "Translation bench generation checkpoint contains duplicate utterances",
                );
            }
            usedUtterances.add(normalized);
        }
    }
    options.onProgress?.(casesBySlot.size, options.caseCount);
    const pending = schedule.entries.filter(
        (entry) => !casesBySlot.has(entry.slot),
    );
    const concurrency = Math.max(
        1,
        Math.min(
            options.concurrency ?? 1,
            pending.length || 1,
            options.caseCount,
        ),
    );
    // Serialize utterance registry + checkpoint JSONL writes across workers.
    let commitChain: Promise<void> = Promise.resolve();
    const runExclusive = async <T>(fn: () => T | Promise<T>): Promise<T> => {
        const prev = commitChain;
        let release!: () => void;
        commitChain = new Promise<void>((resolve) => {
            release = resolve;
        });
        await prev;
        try {
            return await fn();
        } finally {
            release();
        }
    };

    const commitAccepted = async (
        entry: TranslationBenchGenerationScheduleEntry,
        accepted: TranslationBenchAcceptedGeneration,
    ): Promise<"ok" | "collision"> =>
        runExclusive(() => {
            const utterances = [
                accepted.candidate.seed.utterance,
                ...accepted.candidate.genCases.map((g) => g.utterance),
            ].map(normalizedUtterance);
            if (utterances.some((u) => usedUtterances.has(u))) {
                return "collision";
            }
            const evalCase = acceptedToCase(
                entry,
                anchors[entry.slot]!,
                accepted,
                catalog,
                activeSchemas,
                options.generator.model,
                options.reviewer.model,
            );
            casesBySlot.set(entry.slot, evalCase);
            for (const u of utterances) usedUtterances.add(u);
            if (options.checkpointPath !== undefined) {
                const row: TranslationBenchCheckpointRow<TranslationBenchBenchmarkCaseRecord> =
                    {
                        kind: "translation-bench-row",
                        version: 1,
                        ...checkpointIdentity(
                            entry,
                            options.generator.model,
                            options.reviewer.model,
                        ),
                        value: evalCase,
                    };
                appendTranslationBenchCheckpointRows(
                    options.checkpointPath,
                    header,
                    [row],
                );
            }
            options.onProgress?.(casesBySlot.size, options.caseCount);
            return "ok";
        });

    let nextPending = 0;
    const slotErrors: { slot: number; message: string }[] = [];
    const worker = async (): Promise<void> => {
        while (true) {
            const index = nextPending++;
            if (index >= pending.length) return;
            const entry = pending[index]!;
            const schema = schemas.get(entry.schemaName)!;
            const loopOptions = {
                targetAction: {
                    schemaName: entry.schemaName,
                    actionName: entry.actionName,
                },
                schema,
                catalogSchemas: catalog,
                anchor: anchors[entry.slot]!,
                activeSchemas,
                genCaseCount: options.genCaseCount,
                maxAttempts: options.maxAttempts,
                generator: options.generator,
                reviewer: options.reviewer,
            };

            try {
                // Snapshot forbidden utterances so workers do not share a live Set
                // during LLM rounds; commit re-checks under the exclusive lock.
                let accepted = await runTranslationBenchGenerationQualityLoop({
                    ...loopOptions,
                    forbiddenUtterances: new Set(usedUtterances),
                });
                if ((await commitAccepted(entry, accepted)) === "ok") continue;

                // Rare race: another worker claimed an overlapping utterance first.
                accepted = await runTranslationBenchGenerationQualityLoop({
                    ...loopOptions,
                    forbiddenUtterances: usedUtterances,
                });
                if ((await commitAccepted(entry, accepted)) !== "ok") {
                    throw new Error(
                        `Translation bench parallel generation produced duplicate utterance on slot ${entry.slot}`,
                    );
                }
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                slotErrors.push({ slot: entry.slot, message });
                // Keep other workers progressing; fail the run after the pool drains.
            }
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(concurrency, pending.length || 1) }, () =>
            worker(),
        ),
    );
    if (slotErrors.length > 0) {
        const sample = slotErrors
            .slice(0, 5)
            .map((e) => `slot ${e.slot}: ${e.message}`)
            .join(" | ");
        throw new Error(
            `Translation bench generation failed on ${slotErrors.length}/${pending.length} slots. ${sample}`,
        );
    }
    const cases = schedule.entries.map((entry) =>
        finalizeTranslationBenchGeneratedCaseLineage(
            casesBySlot.get(entry.slot)!,
            catalog,
        ),
    );
    const usage = aggregateUsage(cases);
    const estimatedCosts = cases.flatMap(
        (evalCase) =>
            evalCase.generation?.attempts.flatMap((attempt) => [
                attempt.generator.estimatedCostUsd,
                attempt.reviewer?.estimatedCostUsd,
            ]) ?? [],
    );
    const totalCost = estimatedCosts.every(
        (value): value is number => value !== undefined,
    )
        ? estimatedCosts.reduce((sum, value) => sum + value, 0)
        : undefined;
    const benchmark: TranslationBenchBenchmark = {
        metadata: {
            recordType: "metadata",
            version: 1,
            name: options.name,
            schemas: catalog,
            ...(options.pricing !== undefined
                ? { pricing: structuredClone(options.pricing) }
                : {}),
            construction: {
                method: "llm-assisted",
                model: options.generator.model,
                promptHash: hashJson(header.settings),
                responseHash: hashJson(
                    cases.map((evalCase) => evalCase.generation!.candidateHash),
                ),
                attemptCount: cases.reduce(
                    (sum, evalCase) =>
                        sum + evalCase.generation!.attempts.length,
                    0,
                ),
                ...(usage !== undefined ? { usage } : {}),
                ...(totalCost !== undefined
                    ? { estimatedCostUsd: totalCost }
                    : {}),
                catalogSchemaHashes: Object.fromEntries(
                    catalog.map((schema) => [
                        schema.schemaName,
                        schema.typeAgent!.sourceHash,
                    ]),
                ),
                sourceManifestHash: computeTranslationBenchSourceManifestHash(
                    options.sourceManifest,
                ),
                decisionLedger: decisionLedger(cases),
                generation: {
                    contractVersion:
                        TRANSLATION_BENCH_GENERATION_CONTRACT_VERSION,
                    generatorModel: options.generator.model,
                    reviewerModel: options.reviewer.model,
                    caseCount: options.caseCount,
                    genCaseCount: options.genCaseCount,
                    maxAttempts: options.maxAttempts,
                    coverage: schedule.coverage,
                    runFingerprint: header.runFingerprint,
                },
            },
            approval: { status: "draft" },
        },
        cases,
    };
    validateTranslationBenchBenchmark(benchmark);
    return { benchmark, coverage: schedule.coverage };
}
