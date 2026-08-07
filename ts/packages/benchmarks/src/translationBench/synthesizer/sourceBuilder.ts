import { createHash } from "node:crypto";

import {
    fromJSONParsedActionSchema,
    validateAction,
} from "@typeagent/action-schema";
import { z } from "zod";

import {
    assertTranslationBenchBenchmarkMatchesTypeAgentCatalog,
    computeTranslationBenchCanonicalPayloadHash,
    computeTranslationBenchRawRowHash,
    computeTranslationBenchSourceManifestHash,
    computeTranslationBenchSourceSliceHash,
    completeTranslationBenchDatasetBuilderWithRepair,
    createTranslationBenchTypeAgentSchemaCatalog,
    materializeTranslationBenchBenchmark,
    type TranslationBenchBenchmark,
    type TranslationBenchBenchmarkAction,
    type TranslationBenchBenchmarkPricing,
    type TranslationBenchBenchmarkProbePayload,
    type TranslationBenchPublicProbe,
    type TranslationBenchPublicTurnLineage,
    type TranslationBenchBenchmarkSchema,
    type TranslationBenchBuilderRole,
    type TranslationBenchDatasetBuilderCompletion,
    type TranslationBenchDatasetBuilderLlm,
    type TranslationBenchPublicCandidate,
    type TranslationBenchShapeOnlyProbe,
    type TranslationBenchTargetAction,
} from "./benchmark.js";
import type { ActionConfigProvider } from "agent-dispatcher/internal";
import type { TranslationBenchScenario } from "./scenario.js";
import { assertTranslationBenchMinimumVisibleActions } from "./generationSupport.js";
import {
    TRANSLATION_BENCH_DEFAULT_ACTION_SHAPE,
    assertTranslationBenchExpectedActionArity,
} from "./actionShape.js";
import {
    getTranslationBenchSourceAdapter,
    type TranslationBenchSourceAdapter,
    type TranslationBenchSourceCandidate,
    type TranslationBenchSourceImportOptions,
    type TranslationBenchSourceManifest,
} from "./sourceAdapter.js";
// Register built-in adapters (side effect).
import "./adapters/seedQaJsonlAdapter.js";

export type {
    TranslationBenchSourceAdapter,
    TranslationBenchSourceCall,
    TranslationBenchSourceCandidate,
    TranslationBenchSourceImportOptions,
    TranslationBenchSourceManifest,
} from "./sourceAdapter.js";

export interface TranslationBenchSourceActionMapping {
    sourceCallIndex: number;
    targetAction: TranslationBenchTargetAction;
}

export interface TranslationBenchSourceScoreDecision {
    decision: "score";
    candidateId: string;
    bankId: string;
    role: TranslationBenchBuilderRole;
    targetAction: TranslationBenchTargetAction;
    actionMappings: TranslationBenchSourceActionMapping[];
    dimensions: Record<string, string | number | boolean>;
    rationale: string;
    confidence: number;
}

export interface TranslationBenchSourceSkipDecision {
    decision: "skip";
    candidateId: string;
    rationale: string;
}

export interface TranslationBenchSourceShapeOnlyDecision {
    decision: "shapeOnly";
    candidateId: string;
    bankId: string;
    probe: TranslationBenchBenchmarkProbePayload;
    dimensions: Record<string, string | number | boolean>;
    rationale: string;
}

export type TranslationBenchSourceBuilderDecision =
    | TranslationBenchSourceScoreDecision
    | TranslationBenchSourceSkipDecision
    | TranslationBenchSourceShapeOnlyDecision;

export interface TranslationBenchSourceMaterializeOptions {
    name: string;
    candidates: TranslationBenchSourceCandidate[];
    catalog: TranslationBenchBenchmarkSchema[];
    decisions: unknown;
    construction: {
        model: string;
        promptHash: string;
        responseHash: string;
        completion?: TranslationBenchDatasetBuilderCompletion;
        sourceManifestHash: string;
        attemptCount?: number;
        repairTranscriptHash?: string;
    };
    pricing?: Record<string, TranslationBenchBenchmarkPricing>;
    scenarios?: TranslationBenchScenario[];
}

export interface TranslationBenchSourceLlmBuildOptions {
    name: string;
    sourceText: string;
    provider: ActionConfigProvider;
    llm: TranslationBenchDatasetBuilderLlm;
    sourceManifest: TranslationBenchSourceManifest;
    adapter?: string | TranslationBenchSourceAdapter;
    rowIndices?: number[];
    maxCandidates?: number;
    schemaNames?: string[];
    minimumActionCount?: number;
    pricing?: Record<string, TranslationBenchBenchmarkPricing>;
    scenarios?: TranslationBenchScenario[];
}

const dimensionValueSchema = z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
]);
const dimensionsSchema = z.record(z.string(), dimensionValueSchema);
const targetActionSchema = z
    .object({
        schemaName: z.string().trim().min(1),
        actionName: z.string().trim().min(1),
    })
    .strict();
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
const scoreDecisionSchema = z
    .object({
        decision: z.literal("score"),
        candidateId: z.string().trim().min(1),
        bankId: z.string().trim().min(1),
        role: z.enum(["seed", "positive", "negative"]),
        targetAction: targetActionSchema,
        actionMappings: z.array(
            z
                .object({
                    sourceCallIndex: z.number().int().nonnegative(),
                    targetAction: targetActionSchema,
                })
                .strict(),
        ),
        dimensions: dimensionsSchema,
        rationale: z.string().trim().min(1),
        confidence: z.number().finite().min(0).max(1),
    })
    .strict();
const skipDecisionSchema = z
    .object({
        decision: z.literal("skip"),
        candidateId: z.string().trim().min(1),
        rationale: z.string().trim().min(1),
    })
    .strict();
const shapeOnlyDecisionSchema = z
    .object({
        decision: z.literal("shapeOnly"),
        candidateId: z.string().trim().min(1),
        bankId: z.string().trim().min(1),
        probe: probeSchema,
        dimensions: dimensionsSchema,
        rationale: z.string().trim().min(1),
    })
    .strict();
const decisionsSchema = z.array(
    z.discriminatedUnion("decision", [
        scoreDecisionSchema,
        skipDecisionSchema,
        shapeOnlyDecisionSchema,
    ]),
);

function sha256Text(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error("Value is not JSON serializable");
    return sha256Text(json);
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

export function assertTranslationBenchSourceManifest(
    manifest: TranslationBenchSourceManifest,
): void {
    for (const [name, value] of Object.entries(manifest)) {
        requireString(value, `source manifest ${name}`);
    }
    if (!/^[a-f0-9]{64}$/.test(manifest.sourceFileHash)) {
        throw new Error("source manifest has an invalid sourceFileHash");
    }
    const url = new URL(manifest.sourceUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("source manifest URL must use HTTP(S)");
    }
}

export const assertTranslationBenchPinnedSourceManifest =
    assertTranslationBenchSourceManifest;

export interface TranslationBenchImportSourceOptions extends TranslationBenchSourceImportOptions {
    adapter?: string | TranslationBenchSourceAdapter;
}

export function importTranslationBenchSourceCandidates(
    text: string,
    options: TranslationBenchImportSourceOptions,
): TranslationBenchSourceCandidate[] {
    assertTranslationBenchSourceManifest(options.manifest);
    const adapter =
        typeof options.adapter === "object" && options.adapter !== null
            ? options.adapter
            : getTranslationBenchSourceAdapter(
                  typeof options.adapter === "string" && options.adapter.trim()
                      ? options.adapter.trim()
                      : "seed-qa-jsonl",
              );
    return adapter.importCandidates(text, options);
}

export function formatTranslationBenchSourceBuilderPrompt(
    candidates: TranslationBenchSourceCandidate[],
    catalog: TranslationBenchBenchmarkSchema[],
): string {
    const parsedCatalog = catalog.map((schema) => ({
        schema,
        parsed: fromJSONParsedActionSchema(
            structuredClone(schema.typeAgent!.parsedActionSchema),
        ),
    }));
    const sourceViews = [...candidates]
        .sort((left, right) =>
            left.candidateId < right.candidateId
                ? -1
                : left.candidateId > right.candidateId
                  ? 1
                  : 0,
        )
        .map((candidate) => ({
            candidateId: candidate.candidateId,
            lineage: candidate.lineage,
            utterance: candidate.utterance,
            ...(candidate.history !== undefined
                ? { history: candidate.history }
                : {}),
            order: candidate.order,
            sourceTools: candidate.sourceTools,
            sourceCalls: candidate.sourceCalls,
            exactArgumentMatches: candidate.sourceCalls.map(
                (call, sourceCallIndex) => ({
                    sourceCallIndex,
                    targets: parsedCatalog
                        .flatMap(({ schema, parsed }) =>
                            [...parsed.actionSchemas].flatMap(
                                ([actionName, definition]) => {
                                    try {
                                        validateAction(definition, {
                                            actionName,
                                            parameters: call.parameters,
                                        });
                                        return [
                                            {
                                                schemaName: schema.schemaName,
                                                actionName,
                                            },
                                        ];
                                    } catch {
                                        return [];
                                    }
                                },
                            ),
                        )
                        .sort((left, right) => {
                            const leftName = `${left.schemaName}.${left.actionName}`;
                            const rightName = `${right.schemaName}.${right.actionName}`;
                            return leftName < rightName
                                ? -1
                                : leftName > rightName
                                  ? 1
                                  : 0;
                        }),
                }),
            ),
            sourceResponses: candidate.sourceResponses,
            dimensions: candidate.dimensions,
        }));
    const catalogView = catalog.map((schema) => ({
        schemaName: schema.schemaName,
        description: schema.description,
        sourceHash: schema.typeAgent?.sourceHash,
        tools: schema.tools,
    }));
    return [
        "Align pinned source human intents to existing TypeAgent schema actions for an action-translation and explainer benchmark.",
        "Return only a JSON array with exactly one strict decision for every candidateId: score, skip, or shapeOnly.",
        'For score, return exactly these keys: decision, candidateId, bankId, role, targetAction, actionMappings, dimensions, rationale, confidence. targetAction and every actionMappings.targetAction must be an object with schemaName and actionName, never a qualified-name string. Example: {"decision":"score","candidateId":"source-id","bankId":"bank-id","role":"seed","targetAction":{"schemaName":"utility","actionName":"webSearch"},"actionMappings":[{"sourceCallIndex":0,"targetAction":{"schemaName":"utility","actionName":"webSearch"}}],"dimensions":{},"rationale":"exact source arguments validate","confidence":0.9}.',
        'For skip, return exactly decision, candidateId, and rationale. Example: {"decision":"skip","candidateId":"source-id","rationale":"no faithful mapping"}.',
        "Do not copy score, utterance, history, order, lineage, sourceTools, sourceCalls, sourceResponses, parameters, or any other source field into a score or skip decision. The builder preserves those source fields itself after validating the decision.",
        "For each sourceCallIndex, actionMappings.targetAction must be one of that candidate's exactArgumentMatches.targets. Those targets have already passed deterministic validation with the unchanged source arguments. If no semantically correct exact match exists, use skip.",
        "Use score only when every source call's exact arguments validate without renaming, coercion, insertion, or deletion against the selected existing TypeAgent action. Positive and seed decisions require calls; negative decisions require a no-call clarification turn and empty actionMappings.",
        "Use exactly one seed plus at least one positive and one negative in each bank, all with the same targetAction. Omit no candidate: use skip with a rationale when no faithful existing-action mapping or useful bank role exists.",
        "Use shapeOnly only for a rewritten adaptation. It must contain candidateId, bankId, probe, dimensions, rationale. Shape-only probes are never scored and cannot satisfy a bank's seed/positive/negative requirements.",
        JSON.stringify({
            sourceCandidates: sourceViews,
            typeAgentCatalog: catalogView,
        }),
    ].join("\n");
}

export function parseTranslationBenchSourceBuilderDecisions(
    value: unknown,
): TranslationBenchSourceBuilderDecision[] {
    return decisionsSchema.parse(
        value,
    ) as TranslationBenchSourceBuilderDecision[];
}

function candidateMap(candidates: TranslationBenchSourceCandidate[]) {
    const map = new Map<string, TranslationBenchSourceCandidate>();
    for (const candidate of candidates) {
        if (!candidate.candidateId.trim() || map.has(candidate.candidateId)) {
            throw new Error(
                `Duplicate or empty source candidate '${candidate.candidateId}'`,
            );
        }
        if (
            computeTranslationBenchRawRowHash(candidate.rawRow) !==
            candidate.lineage.rawRowHash
        ) {
            throw new Error(
                `source candidate '${candidate.candidateId}' raw row hash drift`,
            );
        }
        if (
            computeTranslationBenchSourceSliceHash(candidate.sourceSlice) !==
            candidate.lineage.sourceSliceHash
        ) {
            throw new Error(
                `source candidate '${candidate.candidateId}' source slice hash drift`,
            );
        }
        const normalized =
            typeof candidate.sourceSlice === "object" &&
            candidate.sourceSlice !== null &&
            "normalized" in candidate.sourceSlice
                ? (candidate.sourceSlice as { normalized: unknown }).normalized
                : undefined;
        const candidateView = {
            utterance: candidate.utterance,
            ...(candidate.history !== undefined
                ? { history: candidate.history }
                : {}),
            order: candidate.order,
            sourceTools: candidate.sourceTools,
            sourceCalls: candidate.sourceCalls,
            sourceResponses: candidate.sourceResponses,
        };
        if (normalized === undefined) {
            throw new Error(
                `source candidate '${candidate.candidateId}' missing sourceSlice.normalized`,
            );
        }
        if (sha256Json(normalized) !== sha256Json(candidateView)) {
            throw new Error(
                `source candidate '${candidate.candidateId}' normalized source drift`,
            );
        }
        map.set(candidate.candidateId, candidate);
    }
    return map;
}

function catalogMap(catalog: TranslationBenchBenchmarkSchema[]) {
    const map = new Map<string, TranslationBenchBenchmarkSchema>();
    for (const schema of catalog) {
        if (schema.typeAgent === undefined) {
            throw new Error(
                `Builder catalog schema '${schema.schemaName}' is not pinned to TypeAgent`,
            );
        }
        if (map.has(schema.schemaName)) {
            throw new Error(`Duplicate builder schema '${schema.schemaName}'`);
        }
        map.set(schema.schemaName, schema);
    }
    if (map.size === 0) throw new Error("Builder catalog is empty");
    return map;
}

function mappedAction(
    candidate: TranslationBenchSourceCandidate,
    mapping: TranslationBenchSourceActionMapping,
    catalog: Map<string, TranslationBenchBenchmarkSchema>,
): TranslationBenchBenchmarkAction {
    const sourceCall = candidate.sourceCalls[mapping.sourceCallIndex];
    if (sourceCall === undefined) {
        throw new Error(
            `Candidate '${candidate.candidateId}' maps missing source call ${mapping.sourceCallIndex}`,
        );
    }
    const schema = catalog.get(mapping.targetAction.schemaName);
    const tool = schema?.tools.find(
        (item) => item.function.name === mapping.targetAction.actionName,
    );
    if (schema === undefined || tool === undefined) {
        throw new Error(
            `Candidate '${candidate.candidateId}' maps unknown existing TypeAgent action '${mapping.targetAction.schemaName}.${mapping.targetAction.actionName}'`,
        );
    }
    return {
        ...mapping.targetAction,
        parameters: structuredClone(sourceCall.parameters),
    };
}

function assertDecisionsCoverCandidates(
    decisions: TranslationBenchSourceBuilderDecision[],
    candidates: Map<string, TranslationBenchSourceCandidate>,
): void {
    const decided = new Set<string>();
    for (const decision of decisions) {
        if (!candidates.has(decision.candidateId)) {
            throw new Error(
                `Unknown source candidate '${decision.candidateId}'`,
            );
        }
        if (decided.has(decision.candidateId)) {
            throw new Error(
                `source candidate '${decision.candidateId}' has multiple decisions`,
            );
        }
        decided.add(decision.candidateId);
    }
    for (const candidateId of candidates.keys()) {
        if (!decided.has(candidateId)) {
            throw new Error(
                `source candidate '${candidateId}' has no builder decision`,
            );
        }
    }
}

function applyShapeOnlyDecision(
    decision: TranslationBenchSourceShapeOnlyDecision,
    options: TranslationBenchSourceMaterializeOptions,
    shapeOnly: Record<string, TranslationBenchShapeOnlyProbe[]>,
): void {
    const probes = shapeOnly[decision.bankId] ?? [];
    probes.push({
        id: `${decision.candidateId}:shape-only`,
        scored: false,
        origin: "llm-authored",
        ...structuredClone(decision.probe),
        dimensions: structuredClone(decision.dimensions),
        generator: {
            model: options.construction.model,
            promptHash: options.construction.promptHash,
        },
    });
    shapeOnly[decision.bankId] = probes;
}

function applyScoreDecision(
    decision: TranslationBenchSourceScoreDecision,
    candidate: TranslationBenchSourceCandidate,
    options: TranslationBenchSourceMaterializeOptions,
    catalog: Map<string, TranslationBenchBenchmarkSchema>,
    activeSchemas: string[],
    scoredCandidates: TranslationBenchPublicCandidate[],
    selections: {
        candidateId: string;
        bankId: string;
        role: TranslationBenchBuilderRole;
        targetAction: TranslationBenchTargetAction;
        dimensions: Record<string, string | number | boolean>;
        rationale: string;
        confidence: number;
    }[],
): void {
    const sourceCallIndexes = decision.actionMappings.map(
        (mapping) => mapping.sourceCallIndex,
    );
    if (new Set(sourceCallIndexes).size !== sourceCallIndexes.length) {
        throw new Error(
            `Candidate '${candidate.candidateId}' maps a source call more than once`,
        );
    }
    if (decision.role === "negative") {
        if (
            candidate.sourceCalls.length !== 0 ||
            decision.actionMappings.length !== 0
        ) {
            throw new Error(
                `Candidate '${candidate.candidateId}' negative role requires a no-call source turn`,
            );
        }
    } else if (
        // Simple-action only: one source call mapped once. Multi reserved.
        candidate.sourceCalls.length !== 1 ||
        decision.actionMappings.length !== 1 ||
        sourceCallIndexes[0] !== 0
    ) {
        throw new Error(
            `Candidate '${candidate.candidateId}' simple-action score requires exactly one source call mapped at index 0`,
        );
    }
    const expectedActions = decision.actionMappings.map((mapping) =>
        mappedAction(candidate, mapping, catalog),
    );
    assertTranslationBenchExpectedActionArity(
        expectedActions,
        decision.role,
        TRANSLATION_BENCH_DEFAULT_ACTION_SHAPE,
        `Candidate '${candidate.candidateId}'`,
    );
    if (
        decision.role !== "negative" &&
        !expectedActions.some(
            (action) =>
                action.schemaName === decision.targetAction.schemaName &&
                action.actionName === decision.targetAction.actionName,
        )
    ) {
        throw new Error(
            `Candidate '${candidate.candidateId}' does not map the bank target action`,
        );
    }
    const probe: TranslationBenchBenchmarkProbePayload = {
        utterance: candidate.utterance,
        expectedActions,
        order: candidate.order,
        ...(candidate.history !== undefined
            ? { history: structuredClone(candidate.history) }
            : {}),
    };
    const lineage: TranslationBenchPublicTurnLineage = {
        ...structuredClone(candidate.lineage),
        canonicalPayloadHash: computeTranslationBenchCanonicalPayloadHash(
            probe,
            options.catalog,
            activeSchemas,
        ),
    };
    scoredCandidates.push({
        candidateId: candidate.candidateId,
        lineage,
        rawRow: structuredClone(candidate.rawRow),
        sourceSlice: structuredClone(candidate.sourceSlice),
        schemas: structuredClone(options.catalog),
        activeSchemas: structuredClone(activeSchemas),
        probe,
    });
    selections.push({
        candidateId: candidate.candidateId,
        bankId: decision.bankId,
        role: decision.role,
        targetAction: structuredClone(decision.targetAction),
        dimensions: structuredClone(decision.dimensions),
        rationale: decision.rationale,
        confidence: decision.confidence,
    });
}

function sourceDecisionLedgerEntry(
    decision: TranslationBenchSourceBuilderDecision,
    candidates: Map<string, TranslationBenchSourceCandidate>,
) {
    const lineage = structuredClone(
        candidates.get(decision.candidateId)!.lineage,
    );
    if (decision.decision === "skip") {
        return {
            decision: decision.decision,
            candidateId: decision.candidateId,
            lineage,
            rationale: decision.rationale,
        };
    }
    if (decision.decision === "shapeOnly") {
        return {
            decision: decision.decision,
            candidateId: decision.candidateId,
            lineage,
            bankId: decision.bankId,
            rationale: decision.rationale,
        };
    }
    return {
        decision: decision.decision,
        candidateId: decision.candidateId,
        lineage,
        bankId: decision.bankId,
        role: decision.role,
        targetAction: structuredClone(decision.targetAction),
        rationale: decision.rationale,
        confidence: decision.confidence,
    };
}

export function materializeTranslationBenchBenchmarkFromSource(
    options: TranslationBenchSourceMaterializeOptions,
): TranslationBenchBenchmark {
    const candidates = candidateMap(options.candidates);
    const catalog = catalogMap(options.catalog);
    const decisions = parseTranslationBenchSourceBuilderDecisions(
        options.decisions,
    );
    assertDecisionsCoverCandidates(decisions, candidates);

    const activeSchemas = [...catalog.keys()];
    const scoredCandidates: TranslationBenchPublicCandidate[] = [];
    const selections: {
        candidateId: string;
        bankId: string;
        role: TranslationBenchBuilderRole;
        targetAction: TranslationBenchTargetAction;
        dimensions: Record<string, string | number | boolean>;
        rationale: string;
        confidence: number;
    }[] = [];
    const shapeOnly: Record<string, TranslationBenchShapeOnlyProbe[]> = {};
    for (const decision of decisions) {
        const candidate = candidates.get(decision.candidateId)!;
        if (decision.decision === "skip") continue;
        if (decision.decision === "shapeOnly") {
            applyShapeOnlyDecision(decision, options, shapeOnly);
            continue;
        }
        applyScoreDecision(
            decision,
            candidate,
            options,
            catalog,
            activeSchemas,
            scoredCandidates,
            selections,
        );
    }
    if (selections.length === 0) {
        throw new Error("source builder produced no scored decisions");
    }
    const completion = options.construction.completion;
    return materializeTranslationBenchBenchmark({
        name: options.name,
        candidates: scoredCandidates,
        selections,
        construction: {
            method: "llm-assisted",
            model: options.construction.model,
            promptHash: options.construction.promptHash,
            responseHash: options.construction.responseHash,
            ...(options.construction.attemptCount !== undefined
                ? { attemptCount: options.construction.attemptCount }
                : {}),
            ...(options.construction.repairTranscriptHash !== undefined
                ? {
                      repairTranscriptHash:
                          options.construction.repairTranscriptHash,
                  }
                : {}),
            sourceManifestHash: options.construction.sourceManifestHash,
            catalogSchemaHashes: Object.fromEntries(
                options.catalog.map((schema) => [
                    schema.schemaName,
                    schema.typeAgent!.sourceHash,
                ]),
            ),
            decisionLedger: [...decisions]
                .sort((left, right) =>
                    left.candidateId < right.candidateId
                        ? -1
                        : left.candidateId > right.candidateId
                          ? 1
                          : 0,
                )
                .map((decision) =>
                    sourceDecisionLedgerEntry(decision, candidates),
                ),
            ...(completion?.usage !== undefined
                ? { usage: structuredClone(completion.usage) }
                : {}),
            ...(completion?.estimatedCostUsd !== undefined
                ? { estimatedCostUsd: completion.estimatedCostUsd }
                : {}),
            ...(completion?.pricing !== undefined
                ? { pricing: structuredClone(completion.pricing) }
                : {}),
        },
        ...(options.pricing !== undefined
            ? { pricing: structuredClone(options.pricing) }
            : {}),
        ...(options.scenarios !== undefined
            ? { scenarios: structuredClone(options.scenarios) }
            : {}),
        shapeOnly,
    });
}

export async function buildTranslationBenchBenchmarkFromSourceWithLlm(
    options: TranslationBenchSourceLlmBuildOptions,
): Promise<TranslationBenchBenchmark> {
    assertTranslationBenchSourceManifest(options.sourceManifest);
    if (!options.llm.model.trim()) {
        throw new Error("source dataset-builder LLM model is required");
    }
    const candidates = importTranslationBenchSourceCandidates(
        options.sourceText,
        {
            ...(options.adapter !== undefined
                ? { adapter: options.adapter }
                : {}),
            manifest: options.sourceManifest,
            ...(options.rowIndices !== undefined
                ? { rowIndices: options.rowIndices }
                : {}),
            ...(options.maxCandidates !== undefined
                ? { maxCandidates: options.maxCandidates }
                : {}),
        },
    );
    const catalog = createTranslationBenchTypeAgentSchemaCatalog(
        options.provider,
        options.schemaNames,
    );
    assertTranslationBenchMinimumVisibleActions(
        catalog,
        options.minimumActionCount ?? 1,
    );
    const prompt = formatTranslationBenchSourceBuilderPrompt(
        candidates,
        catalog,
    );
    return completeTranslationBenchDatasetBuilderWithRepair({
        prompt,
        label: "source dataset-builder LLM",
        llm: options.llm,
        materialize: ({
            decisions,
            completion,
            promptHash,
            responseHash,
            attemptCount,
            repairTranscriptHash,
        }) =>
            materializeTranslationBenchBenchmarkFromSource({
                name: options.name,
                candidates,
                catalog,
                decisions,
                construction: {
                    model: options.llm.model,
                    promptHash,
                    responseHash,
                    completion,
                    sourceManifestHash:
                        computeTranslationBenchSourceManifestHash(
                            options.sourceManifest,
                        ),
                    attemptCount,
                    ...(repairTranscriptHash !== undefined
                        ? { repairTranscriptHash }
                        : {}),
                },
                ...(options.pricing !== undefined
                    ? { pricing: options.pricing }
                    : {}),
                ...(options.scenarios !== undefined
                    ? { scenarios: options.scenarios }
                    : {}),
            }),
    });
}

function probeSourceKey(probe: TranslationBenchPublicProbe): string {
    return `${probe.lineage.rowId}:${probe.lineage.sourcePart}`;
}

function assertProbeLineageMatchesSource(
    key: string,
    probe: TranslationBenchPublicProbe,
    candidate: TranslationBenchSourceCandidate,
): void {
    const lineage = probe.lineage;
    for (const field of [
        "dataset",
        "revision",
        "config",
        "split",
        "rowIndex",
        "rowId",
        "sourceUrl",
        "sourcePart",
        "rawRowHash",
        "sourceSliceHash",
    ] as const) {
        if (lineage[field] !== candidate.lineage[field]) {
            throw new Error(
                `Translation-bench probe '${key}' differs from pinned source lineage.${field}`,
            );
        }
    }
}

function assertProbePayloadMatchesSource(
    key: string,
    probe: TranslationBenchPublicProbe,
    candidate: TranslationBenchSourceCandidate,
): void {
    if (probe.lineage.transformVersion !== candidate.lineage.transformVersion) {
        throw new Error(
            `Translation-bench probe '${key}' differs from pinned source lineage.transformVersion`,
        );
    }
    if (
        sha256Json({
            utterance: probe.utterance,
            ...(probe.history !== undefined ? { history: probe.history } : {}),
            order: probe.order,
        }) !==
        sha256Json({
            utterance: candidate.utterance,
            ...(candidate.history !== undefined
                ? { history: candidate.history }
                : {}),
            order: candidate.order,
        })
    ) {
        throw new Error(
            `Translation-bench probe '${key}' rewrites pinned source text or history`,
        );
    }
    if (probe.expectedActions.length !== candidate.sourceCalls.length) {
        throw new Error(
            `Translation-bench probe '${key}' does not preserve the source-call count`,
        );
    }
    for (let index = 0; index < candidate.sourceCalls.length; index++) {
        if (
            sha256Json(probe.expectedActions[index]!.parameters ?? {}) !==
            sha256Json(candidate.sourceCalls[index]!.parameters)
        ) {
            throw new Error(
                `Translation-bench probe '${key}' rewrites source-call arguments at index ${index}`,
            );
        }
    }
}

function assertCaseProbesMatchSource(
    evalCase: TranslationBenchBenchmark["cases"][number],
    bySource: Map<string, TranslationBenchSourceCandidate>,
): void {
    for (const probe of [evalCase.seed, ...evalCase.generalizations]) {
        const key = probeSourceKey(probe);
        const candidate = bySource.get(key);
        if (candidate === undefined) {
            throw new Error(
                `Translation-bench probe '${key}' is absent from the pinned source`,
            );
        }
        assertProbeLineageMatchesSource(key, probe, candidate);
        if (evalCase.generation !== undefined) {
            if (
                evalCase.generation.anchorCandidateId !== key ||
                probe.lineage.transformVersion !== 2
            ) {
                throw new Error(
                    `Translation-bench generated probe '${key}' has invalid derived lineage`,
                );
            }
            continue;
        }
        assertProbePayloadMatchesSource(key, probe, candidate);
    }
}

export function assertTranslationBenchSourceBenchmarkTrust(
    benchmark: TranslationBenchBenchmark,
    options: {
        sourceText: string;
        sourceManifest: TranslationBenchSourceManifest;
        provider: ActionConfigProvider;
        adapter?: string | TranslationBenchSourceAdapter;
    },
): void {
    assertTranslationBenchSourceManifest(options.sourceManifest);
    assertTranslationBenchBenchmarkMatchesTypeAgentCatalog(
        benchmark,
        options.provider,
    );
    const rowIndices = [
        ...new Set(
            benchmark.cases.flatMap((evalCase) =>
                [evalCase.seed, ...evalCase.generalizations].map(
                    (probe) => probe.lineage.rowIndex,
                ),
            ),
        ),
    ];
    const candidates = importTranslationBenchSourceCandidates(
        options.sourceText,
        {
            ...(options.adapter !== undefined
                ? { adapter: options.adapter }
                : {}),
            manifest: options.sourceManifest,
            rowIndices,
        },
    );
    const bySource = new Map(
        candidates.map((candidate) => [candidate.candidateId, candidate]),
    );
    for (const evalCase of benchmark.cases) {
        assertCaseProbesMatchSource(evalCase, bySource);
    }
}
