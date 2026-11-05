// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createBenchmarkRuntime } from "@typeagent/memory-service/benchmark";
import { clampScore, judge } from "../memoryBench/scoring.js";
import {
    bytesHash,
    digest,
    list,
    object,
    saveJson,
    string,
    text,
} from "../memoryBench/storage.js";
import type { Runtime } from "../memoryBench/types.js";
import {
    gradeAnswer,
    nativeAnswerEvidence,
    nativeSourceEvidence,
    answerJudgeInstructions,
    parseAnswerGrade,
} from "./nativeAnswers.js";
import {
    nativeStateSchema,
    sourceIdentity,
    validateSourceMap,
} from "./runner.js";
import { sourceMapSchema, type SourceMap } from "./retrievers.js";
import {
    incrementalOperations,
    pairedSummary,
    type PairedRow,
} from "./incrementalAnalysis.js";
import {
    createIncrementalController,
    incrementalProtocol,
    type NativeArm,
    type PolicyOptions,
} from "./incrementalPolicy.js";
import {
    freezeJson,
    PairReceipts,
    withExperimentLock,
} from "./incrementalReceipts.js";
import {
    beamSnapshot,
    cloneFrozenStore,
    qmsumSnapshot,
    rejectLinks,
    requireOutside,
    treeIdentity,
    ownExperimentRoot,
    type FrozenInput,
    type PilotQuestion,
    type SnapshotOptions,
} from "./incrementalSnapshots.js";
import {
    verifyConfiguredEmbeddingCompatibility,
    verifyPersistedRawSourceMaps,
} from "./incrementalCompatibility.js";

export interface IncrementalOptions extends SnapshotOptions {
    prepareOnly?: boolean;
    n4?: { gate: "empty" | "term-coverage"; intervention: "N1" | "N2" | "N3" };
    signal?: AbortSignal;
    progress?: (message: string) => void;
}
type RuntimeFactory = (
    store: string,
    options?: Parameters<typeof createBenchmarkRuntime>[1],
) => Promise<Runtime>;
const seed = "bm25-incremental-inspected-pilot-v1";

async function nativeCompiledIdentity() {
    const directory = path.dirname(
        createRequire(import.meta.url).resolve(
            "@typeagent/memory-service/benchmark",
        ),
    );
    return digest(
        await Promise.all(
            [
                "benchmarkBridge.js",
                "indexedFragments.js",
                "knowProCorpusIndex.js",
                "fileMemoryService.js",
            ].map(async (file) => [
                file,
                bytesHash(await readFile(path.join(directory, file))),
            ]),
        ),
    );
}

export function pilotOrder(questions: PilotQuestion[], arms: NativeArm[]) {
    return questions
        .flatMap((question, index) => {
            const shift = index % arms.length;
            return arms
                .slice(shift)
                .concat(arms.slice(0, shift))
                .map((arm) => ({ questionId: question.id, arm }));
        })
        .sort((a, b) => {
            // Keep questions together; rotation counterbalances arm order deterministically.
            const ai = questions.findIndex((q) => q.id === a.questionId);
            const bi = questions.findIndex((q) => q.id === b.questionId);
            return ai - bi;
        });
}

function canonicalNativeMap(
    dataset: FrozenInput["dataset"],
    identity: FrozenInput["identities"][number],
    diagnostic: SourceMap,
) {
    const map = dataset === "beam" && identity.map ? identity.map : diagnostic;
    if (
        diagnostic.sourceId !== map.sourceId ||
        diagnostic.revisionId !== map.revisionId ||
        diagnostic.contentHash !== map.contentHash ||
        diagnostic.totalChars !== map.totalChars
    )
        throw new Error(
            `Native source/revision/raw-content identity changed: ${identity.documentId}`,
        );
    return map;
}

async function validateRuntime(
    runtime: Runtime,
    input: FrozenInput,
    previous?: Record<string, SourceMap>,
    expectedModel?: Record<string, unknown>,
    newQueryLineage = false,
) {
    const capabilities = object(
        await runtime.bridge.execute({ operation: "capabilities" }),
    );
    const model = object(capabilities.benchmark);
    text(model.modelId);
    text(model.nativeAnswerModelId);
    text(model.configurationFingerprint);
    if (expectedModel && digest(model) !== digest(expectedModel))
        throw new Error(
            "New paired runtime model/configuration drift; all arms must match preregistration",
        );
    if (
        !expectedModel &&
        !newQueryLineage &&
        (model.configurationFingerprint !== input.configurationFingerprint ||
            model.modelId !== input.judgeModel ||
            (input.readerModel !== undefined &&
                model.nativeAnswerModelId !== input.readerModel))
    )
        throw new Error(
            `${input.dataset} frozen configuration/model incompatible with current runtime; no reingestion or model substitution permitted`,
        );
    if (!input.readerModel && !newQueryLineage && !expectedModel)
        throw new Error(
            "Frozen BEAM archive lacks native reader-model identity; same-reader parity cannot be verified without a separately approved compatible snapshot",
        );
    const maps: Record<string, SourceMap> = {};
    const mapNormalization: Record<string, unknown>[] = [];
    for (const corpusId of new Set(
        input.identities.map((item) => item.corpusId),
    )) {
        const count = input.identities.filter(
            (item) => item.corpusId === corpusId,
        ).length;
        const corpus = object(
            await runtime.bridge.execute({ operation: "inspect", corpusId }),
        );
        if (
            corpus.sourceCount !== count ||
            corpus.readyRevisionCount !== count ||
            corpus.activeJobCount !== 0
        )
            throw new Error(
                `Frozen corpus is incomplete/not idle: ${corpusId}`,
            );
    }
    for (const identity of input.identities) {
        const diagnostic = sourceMapSchema.parse(
            await runtime.bridge.execute({
                operation: "retrievalSource",
                corpusId: identity.corpusId,
                sourceId: identity.sourceId,
            }),
        );
        const doc = input.documents.find(
            (doc) => doc.id === identity.documentId,
        )!;
        const map = canonicalNativeMap(input.dataset, identity, diagnostic);
        mapNormalization.push({
            documentId: doc.id,
            authoritativeBlocks: map.blocks.length,
            diagnosticReparseBlocks: diagnostic.blocks.length,
            sameBoundaries: digest(map.blocks) === digest(diagnostic.blocks),
            normalization:
                input.dataset === "beam"
                    ? "validated-persisted-original-DocParts; bridge-reparse-is-content/revision-check-only"
                    : "frozen-QMSum-source-map-and-bridge-reparse-identical",
        });
        validateSourceMap(map, doc.text);
        if (
            map.sourceId !== identity.sourceId ||
            (identity.map && digest(identity.map) !== digest(map)) ||
            (previous && digest(previous[doc.id]) !== digest(map))
        )
            throw new Error(
                `Frozen original source/revision changed: ${doc.id}`,
            );
        maps[doc.id] = map;
    }
    return { maps, capabilities, mapNormalization };
}

function evidenceFor(
    response: unknown,
    input: FrozenInput,
    question: PilotQuestion,
    maps: Record<string, SourceMap>,
) {
    const sources = Object.fromEntries(
        input.identities
            .filter((i) => i.corpusId === question.corpusId)
            .map((i) => [i.documentId, maps[i.documentId]]),
    );
    const state = nativeStateSchema.parse({
        corpusId: question.corpusId,
        ready: true,
        fingerprint: "experiment",
        configurationFingerprint: input.configurationFingerprint,
        sources,
    });
    if (object(response).question !== question.text)
        throw new Error(
            "Native response question differs from frozen baseline request",
        );
    if (input.dataset === "beam")
        return nativeSourceEvidence(
            response,
            { documents: input.documents },
            state,
        );
    return nativeAnswerEvidence(
        response,
        { documents: input.documents },
        state,
        question.gold,
    );
}

async function scorePair(
    runtime: Runtime,
    input: FrozenInput,
    question: PilotQuestion,
    response: unknown,
    evidence: ReturnType<typeof evidenceFor>,
    receipts: PairReceipts,
) {
    let judgeOrdinal = 0;
    const grading: Runtime = {
        ...runtime,
        bridge: {
            execute: (request) => {
                if (request.operation !== "generate")
                    throw new Error("Judge may only generate, never retrieve");
                return receipts.generate(
                    request,
                    () => runtime.bridge.execute(request),
                    (response) => {
                        if (input.dataset === "qmsum") {
                            parseAnswerGrade(response);
                            return;
                        }
                        const result = object(response);
                        const properties = object(
                            object(request.schema).properties,
                        );
                        if ("score" in properties) {
                            clampScore(result.score);
                            string(result.reason);
                        } else string(result.answer);
                    },
                    judgeOrdinal++,
                );
            },
        },
    };
    if (input.dataset === "qmsum")
        return gradeAnswer(
            grading,
            {
                id: question.id,
                text: question.text,
                groupId: question.groupId,
                gold: question.gold,
            },
            question.reference!,
            text(object(response).answer),
            evidence.allReaderSources.context.text,
        );
    return judge(
        question.beam!,
        text(object(response).answer),
        input.protocol!,
        async (prompt, properties) =>
            object(
                await grading.bridge.execute({
                    operation: "generate",
                    prompt,
                    schema: {
                        type: "object",
                        properties,
                        required: Object.keys(properties),
                        additionalProperties: false,
                    },
                }),
            ),
    );
}

async function evaluatePair(
    runtime: Runtime,
    input: FrozenInput,
    question: PilotQuestion,
    arm: NativeArm,
    maps: Record<string, SourceMap>,
    receipts: PairReceipts,
    drain: () => Record<string, unknown>[],
): Promise<PairedRow> {
    const base = {
        questionId: question.id,
        groupId: question.groupId,
        category: question.category,
        arm,
    };
    const savedGrade = await receipts.read("grade");
    if (savedGrade) return object(savedGrade.row) as unknown as PairedRow;
    let saved = await receipts.read("answer");
    if (!saved && (await receipts.read("answer-attempt")))
        return {
            ...base,
            state: "answer-failed-or-interrupted-no-automatic-retry",
        };
    const started = performance.now();
    try {
        if (!saved) {
            await receipts.freeze("answer-attempt", {
                request: {
                    operation: "answer",
                    corpusId: question.corpusId,
                    question: question.text,
                    includeDiagnostics: true,
                },
            });
            const response = await receipts.operation("native-answer", () =>
                runtime.bridge.execute({
                    operation: "answer",
                    corpusId: question.corpusId,
                    question: question.text,
                    includeDiagnostics: true,
                }),
            );
            await receipts.freeze("answer", {
                response,
                traces: drain(),
                seconds: (performance.now() - started) / 1000,
                modelOperations: {
                    nativeAnswerOperations: 1,
                    internalModelCalls: null,
                    internalTokens: null,
                    note: "Bridge answer is counted; internal translation/reader/refinement model calls unavailable in native diagnostics",
                },
            });
            saved = (await receipts.read("answer"))!;
        }
        const evidence = evidenceFor(saved.response, input, question, maps);
        await receipts.freeze("evidence", { evidence });
        const grade = await scorePair(
            runtime,
            input,
            question,
            saved.response,
            evidence,
            receipts,
        );
        const correct =
            "verdict" in grade ? grade.verdict === "correct" : grade.correct;
        const traces = list(saved.traces).map(object);
        const row = {
            ...base,
            state: "scored",
            correct,
            verdict:
                "verdict" in grade
                    ? grade.verdict
                    : correct
                      ? "correct"
                      : "incorrect",
            seconds: Number(saved.seconds),
            contextChars: Number(evidence.serializedContextChars),
            refinements: evidence.refinementQueries.length,
            lexicalMs: traces.reduce(
                (sum, trace) => sum + Number(trace.milliseconds),
                0,
            ),
            gateActivations: traces.filter(
                (trace) => trace.stage === "blocks" && trace.activated === true,
            ).length,
            nativeAnswerOperations: 1,
        };
        await receipts.freeze("grade", { grade, correct, row });
        return row;
    } catch (error) {
        await receipts.event({
            phase: saved ? "grading-or-mapping" : "native-answer",
            state: "failed",
            error: error instanceof Error ? error.message : String(error),
            traces: drain(),
        });
        return { ...base, state: saved ? "grade-failed" : "answer-failed" };
    }
}

async function prepareExperiment(
    options: IncrementalOptions,
    input: FrozenInput,
    open: RuntimeFactory,
    verifyEmbeddings: (store: string) => Promise<unknown>,
    verifyRawSources: typeof verifyPersistedRawSourceMaps,
) {
    requireOutside(options.repo, options.output);
    requireOutside(options.snapshot, options.output);
    requireOutside(options.output, options.snapshot);
    await rejectLinks(options.output);
    const hash = await treeIdentity(input.store);
    const arms: NativeArm[] = options.n4
        ? ["N0", "N4"]
        : ["N0", "N1", "N2", "N3"];
    const store = path.join(options.output, "frozen");
    await cloneFrozenStore(input.store, store, hash);
    const embeddingCompatibility = await verifyEmbeddings(store);
    const runtime = await open(store);
    let readiness: Awaited<ReturnType<typeof validateRuntime>>;
    try {
        readiness = await validateRuntime(
            runtime,
            input,
            undefined,
            undefined,
            options.newQueryLineage,
        );
    } finally {
        await runtime.close();
    }
    const rawSourceCompatibility = await verifyRawSources(
        store,
        input,
        readiness.maps,
    );
    const preregistration = {
        version: "incremental-native-pilot-v1",
        classification: "exploratory-inspected-regression-no-adoption",
        dataset: input.dataset,
        seed,
        orderAlgorithm:
            "frozen-question-order-rotating-arm-latin-counterbalance",
        questions: input.questions.map(
            ({ id, groupId, category, text: query }) => ({
                id,
                groupId,
                category,
                query,
            }),
        ),
        arms,
        order: pilotOrder(input.questions, arms),
        policy: incrementalProtocol,
        n4: options.n4 ?? null,
        budget: {
            maximumQuestions: input.dataset === "qmsum" ? 10 : 20,
            pairs: input.questions.length * arms.length,
            successfulAnswersPerPair: 1,
            answerAttemptsPerPair: 1,
            repeats: 1,
            largerTiers: false,
            ingestion: false,
            nativeInternalRefinement: "unchanged-may-add-model-calls",
            judgeRetries:
                "grade-only-resume-cached-successful-official-nugget-responses",
        },
        acceptance: {
            mechanism:
                "N0 unchanged; exact raw-source maps; no leakage; no-match lexical exclusion; complete observable trace",
            quality:
                "report paired rescues/regressions and categories; no adoption decision from this inspected pilot",
            failures: "visible separate coverage, never retrieval misses",
            holdoutAdoptionThreshold: null,
        },
        cache: "independent-per-arm-store-clones-cold-runtime-per-pair-host-os-cache-uncontrolled",
        snapshot: {
            origin: input.origin,
            storeHash: hash,
            provenance: input.provenance,
            maps: readiness.maps,
            embeddingCompatibility,
            rawSourceCompatibility,
            mapNormalization: readiness.mapNormalization,
        },
        queryLineage: options.newQueryLineage
            ? "fresh-N0-and-all-arms-current-models; historical-model/config-pins-provenance-only; no-historical-score-mixing"
            : "strict-historical-query-model-and-configuration-parity",
        judgeProtocol: input.protocol ?? answerJudgeInstructions,
        source: await sourceIdentity(options.repo),
        scoringCompiledHash: bytesHash(
            await readFile(
                new URL("../memoryBench/scoring.js", import.meta.url),
            ),
        ),
        nativeCompiledHash: await nativeCompiledIdentity(),
        capabilities: readiness.capabilities,
        request: {
            operation: "answer",
            includeDiagnostics: true,
            overrides: null,
        },
    };
    await freezeJson(
        path.join(options.output, "preregistration.json"),
        preregistration,
    );
    return {
        preregistration,
        fingerprint: digest(preregistration),
        readiness,
        arms,
        hash,
        store,
    };
}

async function executeIncremental(
    options: IncrementalOptions,
    open: RuntimeFactory,
    verifyEmbeddings: (store: string) => Promise<unknown>,
    verifyRawSources: typeof verifyPersistedRawSourceMaps,
) {
    if (options.n4 && !options.prepareOnly)
        throw new Error(
            "N4 live execution requires a separately approved budget; the current authorization is N0–N3 only",
        );
    const input =
        options.dataset === "qmsum"
            ? await qmsumSnapshot(options)
            : await beamSnapshot(options);
    const prepared = await prepareExperiment(
        options,
        input,
        open,
        verifyEmbeddings,
        verifyRawSources,
    );
    if (options.prepareOnly)
        return {
            state: "preregistered",
            fingerprint: prepared.fingerprint,
            pairs: prepared.preregistration.budget.pairs,
        };
    const rows: PairedRow[] = [];
    for (const entry of prepared.preregistration.order) {
        options.signal?.throwIfAborted();
        const question = input.questions.find(
            (q) => q.id === entry.questionId,
        )!;
        options.progress?.(`${entry.arm}: ${question.id}`);
        const directory = path.join(
            options.output,
            "pairs",
            entry.arm,
            bytesHash(question.id),
        );
        const receipts = new PairReceipts(directory, prepared.fingerprint);
        const store = path.join(options.output, "arms", entry.arm, "store");
        await cloneFrozenStore(input.store, store, prepared.hash);
        const identities = input.identities.filter(
            (item) => item.corpusId === question.corpusId,
        );
        const policy: PolicyOptions = { arm: entry.arm, ...options.n4 };
        const controller = createIncrementalController(
            question.corpusId,
            identities.map((i) => prepared.readiness.maps[i.documentId]),
            policy,
        );
        const runtime = await open(store, {
            indexedFragmentPolicy: controller.policyFor,
        });
        try {
            await validateRuntime(
                runtime,
                input,
                prepared.readiness.maps,
                object(prepared.readiness.capabilities.benchmark),
            );
            await verifyRawSources(store, input, prepared.readiness.maps);
            rows.push(
                await evaluatePair(
                    runtime,
                    input,
                    question,
                    entry.arm,
                    prepared.readiness.maps,
                    receipts,
                    controller.drain,
                ),
            );
            await validateRuntime(
                runtime,
                input,
                prepared.readiness.maps,
                object(prepared.readiness.capabilities.benchmark),
            );
            await verifyRawSources(store, input, prepared.readiness.maps);
        } finally {
            await runtime.close();
        }
        await saveJson(path.join(options.output, "rows.json"), rows);
        await saveJson(path.join(options.output, "paired-analysis.json"), {
            ...pairedSummary(rows, input.questions, prepared.arms),
            operations: await incrementalOperations(
                options.output,
                input.questions,
                prepared.arms,
            ),
        });
    }

    if ((await treeIdentity(input.store)) !== prepared.hash)
        throw new Error("Original frozen store changed during experiment");
    return {
        state: rows.some((row) => row.correct === undefined)
            ? "partial"
            : "complete",
        fingerprint: prepared.fingerprint,
        summary: {
            ...pairedSummary(rows, input.questions, prepared.arms),
            operations: await incrementalOperations(
                options.output,
                input.questions,
                prepared.arms,
            ),
        },
    };
}

export async function runIncremental(
    options: IncrementalOptions,
    open: RuntimeFactory = createBenchmarkRuntime,
    verifyEmbeddings: (
        store: string,
    ) => Promise<unknown> = verifyConfiguredEmbeddingCompatibility,
    verifyRawSources: typeof verifyPersistedRawSourceMaps = verifyPersistedRawSourceMaps,
) {
    requireOutside(options.repo, options.output);
    requireOutside(options.snapshot, options.output);
    requireOutside(options.output, options.snapshot);
    await rejectLinks(options.output);
    await ownExperimentRoot(options.output, {
        version: "incremental-native-owned-root-v1",
        dataset: options.dataset,
        snapshot: path.resolve(options.snapshot),
        references: path.resolve(options.references),
    });
    return withExperimentLock(options.output, async () => {
        try {
            const result = await executeIncremental(
                options,
                open,
                verifyEmbeddings,
                verifyRawSources,
            );
            await saveJson(path.join(options.output, "status.json"), {
                state: result.state,
                fingerprint: result.fingerprint,
            });
            return result;
        } catch (error) {
            await saveJson(path.join(options.output, "status.json"), {
                state: "failed",
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    });
}
