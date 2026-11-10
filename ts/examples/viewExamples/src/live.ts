// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
    openai,
    initRuntimeConfigFromProcessEnv,
    countO200kTokens,
    RequestBudget,
    runWithRequestBudget,
    type ChatModel,
    type RequestBudgetLimits,
    type RequestBudgetReceipt,
} from "@typeagent/aiclient";
import { loadConfigSync } from "@typeagent/config";
import {
    FileMemoryService,
    inspectMemoryViewPackage,
    loadMemoryViewPackage,
    createConfiguredViewSynthesisAdapter,
    viewExtensionDigest,
    type ViewBuildJob,
    type ViewDefinitionInput,
    type ViewVersion,
} from "@typeagent/memory-service";
import { viewContentToText } from "@typeagent/memory-service/view-text";
import {
    packageRoot,
    hostOptions,
    completedIngestion,
    procedureDefinition,
    settleBuild,
} from "./host.js";
import { proseProviderId } from "./procedural/proseProvider.js";
import {
    abcdPin,
    exampleFlows,
    selectExampleSources,
    loadAbcd,
    parsePrediction,
    scorePrediction,
    type GuidelineDocument,
    type DevelopmentCase,
    type ActionPrediction,
} from "./abcd.js";

type PredictionRow = {
    id: string;
    flowId: string;
    mode: string;
    state: "returned" | "failed" | "missing-build";
    predicted?: ActionPrediction;
    gold: ActionPrediction;
    score?: ReturnType<typeof scorePrediction>;
    error?: string;
};

type Attempt = {
    stage: string;
    state: "started" | "returned" | "failed";
    elapsedMs: number;
    usage: unknown[];
    error?: string;
    promptDigest: string;
    reservations: RequestBudgetReceipt[];
    output?: string;
};

function approvedConfiguredModel() {
    loadConfigSync();
    initRuntimeConfigFromProcessEnv();
    const native = openai.createChatModelDefault(
        "procedure-approved-development",
    );
    if (!native.inspectRequest)
        throw new Error("Configured model lacks request-budget inspection");
    const inspected = native.inspectRequest([
        { role: "system", content: "Return a JSON object." },
    ]);
    if (inspected.constraints.outputTokens > 1000000)
        throw new Error(
            "Configured native output capacity exceeds the approved one-million-token ceiling",
        );
    const inputTokens = inspected.constraints.declaredLimits?.inputTokens;
    const contextTokens = inspected.constraints.declaredLimits?.contextTokens;
    if (!inputTokens || !contextTokens)
        throw new Error(
            "Configured model needs declared input/context request limits",
        );
    const identity = viewExtensionDigest(
        openai.getChatModelPool().members.map(({ settings }) => ({
            provider: settings.provider,
            modelType: settings.modelType,
            endpoint: settings.endpoint,
            requestConstraints: settings.requestConstraints,
            modelName: settings.modelName,
            wireApi: settings.wireApi,
            completionSettings: native.completionSettings,
        })),
    );
    const limits: RequestBudgetLimits = {
        tokenizer: "o200k_base",
        countTokens: countO200kTokens,
        inputTokens,
        contextTokens,
        outputTokens: 1000000,
        safetyTokens: 1024,
        chatAttempts: 12,
        embeddingAttempts: 1,
        reservedTokens: 12 * (inputTokens + inspected.constraints.outputTokens),
        elapsedMs: 600000,
    };
    return {
        native,
        identity,
        limits,
        nativeOutputReservation: inspected.constraints.outputTokens,
    };
}

function observedModel(
    native: ChatModel,
    limits: RequestBudgetLimits,
    stage: () => string,
    attempts: Attempt[],
    directory: string,
): ChatModel {
    return {
        completionSettings: native.completionSettings,
        ...(native.inspectRequest
            ? { inspectRequest: native.inspectRequest.bind(native) }
            : {}),
        complete: async (prompt, callback, schema, log, signal) => {
            const budget = new RequestBudget(limits);
            const started = Date.now();
            const usage: unknown[] = [];
            const attempt: Attempt = {
                stage: stage(),
                state: "started",
                elapsedMs: 0,
                usage,
                promptDigest: viewExtensionDigest(prompt),
                reservations: [],
            };
            attempts.push(attempt);
            const persist = () =>
                writeFile(
                    path.join(directory, "attempts.json"),
                    JSON.stringify(attempts, null, 2),
                );
            await persist();
            try {
                const result = await runWithRequestBudget(budget, () =>
                    native.complete(
                        prompt,
                        (stats) => {
                            usage.push(stats);
                            callback?.(stats);
                        },
                        schema,
                        log,
                        signal,
                    ),
                );
                Object.assign(attempt, {
                    state: result.success ? "returned" : "failed",
                    elapsedMs: Date.now() - started,
                    reservations: budget.receipts,
                    ...(result.success ? {} : { error: result.message }),
                    ...(result.success ? { output: result.data } : {}),
                });
                await persist();
                return result;
            } catch (error) {
                Object.assign(attempt, {
                    state: "failed",
                    elapsedMs: Date.now() - started,
                    reservations: budget.receipts,
                    error: String(error),
                });
                await persist();
                throw error;
            }
        },
    };
}

async function savedBuild(
    service: FileMemoryService,
    corpusId: string,
    definition: ViewDefinitionInput,
): Promise<{ job: ViewBuildJob; view?: ViewVersion }> {
    const job = await settleBuild(
        service,
        await service.buildViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            targets: [{ definition, expectedVersion: 0 }],
            publication: false,
        }),
        610000,
    );
    const target = job.results[0];
    if (
        job.state !== "complete" ||
        target?.state !== "draft" ||
        !target.revisionId
    )
        return { job };
    const view = await service.getView({
        corpusId,
        viewId: definition.viewId,
        revisionId: target.revisionId,
    });
    if (!view)
        throw new Error(
            "Completed development build has no readable exact revision",
        );
    return { job, view };
}

async function evaluateCase(
    model: ChatModel,
    evidence: string,
    item: DevelopmentCase,
    actions: string[],
) {
    const result = await model.complete(
        [
            {
                role: "system",
                content: `Predict the next annotated agent decision from this delexicalized development dialogue prefix and source-grounded procedure guidance. This is an offline decision prediction, not tool execution. Never collect real credentials or execute actions. Return only JSON {nextstep:"take_action"|"retrieve_utterance"|"end_conversation",action:string|null,values:string[]}. Use null action and [] values for non-action decisions. Only the supplied canonical action names are allowed. The source may permit multiple valid action orders; do not pretend the gold next action is uniquely implied.`,
            },
            {
                role: "user",
                content: JSON.stringify({
                    evidence,
                    history: item.input.history,
                    canonicalActions: actions,
                }),
            },
        ],
        undefined,
        undefined,
        undefined,
        AbortSignal.timeout(600000),
    );
    if (!result.success) throw new Error(result.message);
    return parsePrediction(JSON.parse(result.data));
}

async function evaluateOrMissing(
    model: ChatModel,
    evidence: string | undefined,
    item: DevelopmentCase,
    actions: string[],
    sourceActions: string[],
    mode: string,
): Promise<PredictionRow> {
    const row = { id: item.id, flowId: item.flowId, mode, gold: item.gold };
    if (!evidence)
        return {
            ...row,
            state: "missing-build",
            error: "Required representation build unavailable; no fallback used",
        };
    try {
        const predicted = await evaluateCase(model, evidence, item, actions);
        return {
            ...row,
            state: "returned",
            predicted,
            score: scorePrediction(item.gold, predicted, sourceActions),
        };
    } catch (error) {
        process.stderr.write(
            `Prediction failed: ${item.id}/${mode}: ${String(error)}\n`,
        );
        return { ...row, state: "failed", error: String(error) };
    }
}

async function verifySavedViews(
    service: FileMemoryService,
    corpusId: string,
    saved: ViewVersion[],
): Promise<void> {
    for (const view of saved) {
        const reopened = await service.getView({
            corpusId,
            viewId: view.viewId,
            revisionId: view.revisionId,
        });
        if (
            !reopened ||
            viewExtensionDigest(reopened.content) !==
                viewExtensionDigest(view.content)
        )
            throw new Error(
                `Exact saved ${view.content.kind} view failed cold restart validation: ${view.viewId}`,
            );
    }
}

function orderedDocuments(
    available: GuidelineDocument[],
    selected: string[] | undefined,
): GuidelineDocument[] {
    if (!selected) return available;
    return selected.map((id) => {
        const document = available.find((document) => document.id === id);
        if (!document)
            throw new Error(`Selected procedural source was not loaded: ${id}`);
        return document;
    });
}

export async function runApprovedPilot(options: {
    outputDirectory: string;
    datasetDirectory: string;
    allowDownload: boolean;
    approvedModelWork: boolean;
    buildOnly?: boolean;
    sourceId?: string;
    sourceIds?: string[];
}) {
    if (options.approvedModelWork !== true)
        throw new Error(
            "Programmatic live pilot requires explicit prior model-work approval",
        );
    const selected = selectExampleSources(
        options.sourceId,
        options.sourceIds,
        options.buildOnly,
    );
    const runScope = options.buildOnly
        ? "source-view-build-only; not an evaluation"
        : "development comparison";
    const comparisonModes = [
        "raw-source-oracle",
        "builtin-troubleshooting",
        "custom-procedure",
    ];
    const approved = approvedConfiguredModel();
    const data = await loadAbcd(
        options.datasetDirectory,
        options.allowDownload,
        selected
            ?.filter((id) => id !== "mock-connectivity")
            .map((id) => exampleFlows.find((flow) => flow.id === id)!),
    );
    await mkdir(options.outputDirectory);
    const attempts: Attempt[] = [];
    let stage = "setup";
    const model = observedModel(
        approved.native,
        approved.limits,
        () => stage,
        attempts,
        options.outputDirectory,
    );
    const directory = path.join(options.outputDirectory, "memory");
    let service = new FileMemoryService(directory, hostOptions([]));
    const corpus = await service
        .createCorpus("Approved fictional/public procedural development")
        .finally(() => service.close());
    const original: GuidelineDocument = {
        id: "mock-connectivity",
        subflow: "original",
        text: await readFile(
            path.join(packageRoot, "fixtures", "connectivity-prose.txt"),
            "utf8",
        ),
        allowedActions: [],
        mappings: [],
    };
    const available = [original, ...data.documents];
    const documents = orderedDocuments(available, selected);
    const installation = await inspectMemoryViewPackage(packageRoot);
    const providers = await loadMemoryViewPackage(installation, [
        {
            providerId: proseProviderId,
            context: {
                corpusId: corpus.corpusId,
                sourceIds: documents.map((document) => document.id),
                authorize: async (_snapshot: unknown, operation: string) =>
                    operation !== "publish",
                approvedModelWork: true,
                model,
                modelIdentity: approved.identity,
            },
        },
    ]);
    const serviceOptions = {
        ...hostOptions(providers),
        viewDrafts: true,
        informationalBudget: approved.limits,
        viewSynthesisAdapter: createConfiguredViewSynthesisAdapter(
            undefined,
            4000,
            model,
        ),
    };
    service = new FileMemoryService(directory, serviceOptions);
    const builds: Array<{
        id: string;
        mode: string;
        state: string;
        job?: ViewBuildJob;
        error?: string;
    }> = [];
    const results: PredictionRow[] = [];
    const saved: ViewVersion[] = [];
    await writeFile(
        path.join(options.outputDirectory, "plan.json"),
        JSON.stringify(
            {
                schemaVersion: 1,
                protocolVersion: 2,
                runScope,
                sourceOrder: documents.map(({ id }) => id),
                abcdPin,
                split: "dev",
                canonicalActionScope:
                    "full pinned ontology; no per-flow action mask",
                actionVocabularyDigest: viewExtensionDigest(
                    data.actionVocabulary,
                ),
                nonemptyGoldSlotCases: data.cases.filter(
                    (item) => item.gold.values.length > 0,
                ).length,
                installationFingerprint: installation.fingerprint,
                cases: options.buildOnly
                    ? []
                    : data.cases.map(({ id, flowId }) => ({ id, flowId })),
                modes: options.buildOnly
                    ? ["custom-procedure"]
                    : comparisonModes,
                rubric: "nextstep/action/value exact agreement; action membership is not full policy validity",
                thresholds: {
                    graphValidity: 1,
                    citationValidity: 1,
                    criticalConstraintLoss: 0,
                },
                quality:
                    "development-only; no improvement claim or holdout threshold selected after seeing outputs",
                modelIdentity: approved.identity,
                approvedOutputCeiling: 1000000,
                nativeOutputReservation: approved.nativeOutputReservation,
                userCallLimit: null,
                perBuildModelStages: 4,
                independentHumanReview: "pending",
            },
            null,
            2,
        ),
    );
    try {
        for (const document of documents) {
            process.stdout.write(`Building ${document.id}\n`);
            const ingestion = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: document.id,
                    sourceType: "text",
                    title: document.text.split(/\r?\n/)[0],
                    text: document.text,
                    metadata:
                        document.subflow === "original"
                            ? {
                                  usageContext:
                                      "original fictional support fixture; not operational instructions",
                              }
                            : {
                                  dataset: abcdPin.repository,
                                  datasetRevision: abcdPin.commit,
                                  usageContext:
                                      "simulated benchmark policy; not operational approval",
                              },
                },
                pipeline: { mode: "content" },
            });
            await completedIngestion(service, ingestion.jobId);
            const source = await service.getSource(
                corpus.corpusId,
                document.id,
            );
            if (!source?.activeRevisionId)
                throw new Error("Development source has no active revision");
            const refs = [
                { sourceId: document.id, revisionId: source.activeRevisionId },
            ];
            const contexts = new Map<string, string>([
                ["raw-source-oracle", document.text],
            ]);
            for (const mode of document.subflow === "original" ||
            options.buildOnly
                ? ["custom-procedure"]
                : ["custom-procedure", "builtin-troubleshooting"]) {
                stage = `build:${document.id}:${mode}`;
                const definition: ViewDefinitionInput =
                    mode === "custom-procedure"
                        ? procedureDefinition(providers[0], document.id, refs)
                        : {
                              viewId: `guide-${document.id}`,
                              kind: "troubleshootingGuide",
                              selector: { kind: "sources", sources: refs },
                          };
                try {
                    const built = await savedBuild(
                        service,
                        corpus.corpusId,
                        definition,
                    );
                    builds.push({
                        id: document.id,
                        mode,
                        state: built.job.results[0]?.state ?? built.job.state,
                        job: built.job,
                    });
                    if (built.view) {
                        saved.push(built.view);
                        contexts.set(
                            mode,
                            viewContentToText(built.view.content),
                        );
                        await writeFile(
                            path.join(
                                options.outputDirectory,
                                `${document.id}-${mode}.json`,
                            ),
                            JSON.stringify(built.view, null, 2),
                        );
                    } else
                        process.stderr.write(
                            `Build unavailable: ${document.id}/${mode}: ${JSON.stringify(built.job.results.map(({ state, reason }) => ({ state, reason })))}\n`,
                        );
                } catch (error) {
                    builds.push({
                        id: document.id,
                        mode,
                        state: "failed",
                        error: String(error),
                    });
                    process.stderr.write(
                        `Build failed: ${document.id}/${mode}: ${String(error)}\n`,
                    );
                }
                await writeFile(
                    path.join(options.outputDirectory, "builds.json"),
                    JSON.stringify(builds, null, 2),
                );
            }
            await writeFile(
                path.join(
                    options.outputDirectory,
                    `${document.id}-source.json`,
                ),
                JSON.stringify(
                    {
                        retainedSourceId: document.id,
                        revisionId: source.activeRevisionId,
                        text: document.text,
                        mappings: document.mappings,
                    },
                    null,
                    2,
                ),
            );
            for (const item of data.cases
                .filter((item) => item.flowId === document.id)
                .filter(() => !options.buildOnly)) {
                for (const mode of [
                    "raw-source-oracle",
                    "builtin-troubleshooting",
                    "custom-procedure",
                ]) {
                    const evidence = contexts.get(mode);
                    stage = `predict:${item.id}:${mode}`;
                    results.push(
                        await evaluateOrMissing(
                            model,
                            evidence,
                            item,
                            data.actionVocabulary,
                            document.allowedActions,
                            mode,
                        ),
                    );
                    await writeFile(
                        path.join(options.outputDirectory, "predictions.json"),
                        JSON.stringify(results, null, 2),
                    );
                }
            }
        }
    } finally {
        await service.close();
        await writeFile(
            path.join(options.outputDirectory, "attempts.json"),
            JSON.stringify(attempts, null, 2),
        );
    }
    stage = "restart-verification";
    const inferenceCount = attempts.length;
    service = new FileMemoryService(directory, serviceOptions);
    try {
        await verifySavedViews(service, corpus.corpusId, saved);
        if (attempts.length !== inferenceCount)
            throw new Error(
                "Cold-read verification unexpectedly invoked inference",
            );
    } finally {
        await service.close();
    }
    const scoreRows = (rows: PredictionRow[]) => ({
        scheduled: rows.length,
        returned: rows.filter((row) => row.state === "returned").length,
        nextstepCorrect: rows.filter((row) => row.score?.nextstep).length,
        actionCorrect: rows.filter((row) => row.score?.action).length,
        valuesCorrect: rows.filter((row) => row.score?.values).length,
        predictedActions: rows.filter(
            (row) => row.predicted?.nextstep === "take_action",
        ).length,
        sourceActionMembership: rows.filter(
            (row) => row.score?.sourceActionMembership,
        ).length,
    });
    const summary = {
        outputDirectory: options.outputDirectory,
        runScope,
        builds: builds.map(({ id, mode, state }) => ({ id, mode, state })),
        scheduledPredictions: options.buildOnly ? 0 : data.cases.length * 3,
        returnedPredictions: results.filter(
            (result) => result.state === "returned",
        ).length,
        modelCalls: attempts.length,
        returnedModelCalls: attempts.filter(
            (attempt) => attempt.state === "returned",
        ).length,
        restartVerified: saved.length,
        modes: comparisonModes
            .filter(() => !options.buildOnly)
            .map((mode) => {
                const rows = results.filter((row) => row.mode === mode);
                return {
                    mode,
                    ...scoreRows(rows),
                    perFlow: data.documents.map(({ id }) => ({
                        flowId: id,
                        ...scoreRows(rows.filter((row) => row.flowId === id)),
                    })),
                };
            }),
        independentReview: "pending",
        billingCost: "not reported by this model interface",
    };
    await writeFile(
        path.join(options.outputDirectory, "summary.json"),
        JSON.stringify(summary, null, 2),
    );
    return summary;
}

async function main() {
    const { values: args } = parseArgs({
        options: {
            "approved-model-work": { type: "boolean" },
            "approved-abcd-download": { type: "boolean" },
            "build-only": { type: "boolean" },
            source: { type: "string" },
            sources: { type: "string" },
        },
    });
    if (!args["approved-model-work"])
        throw new Error(
            "Usage: pnpm live --approved-model-work [--approved-abcd-download] [--build-only --source shopping-cart | --sources slow-speed,search-not-working,initiate-refund,missing-item]. Requires explicit prior approval for configured-model requests and local ABCD data.",
        );
    const runs = path.join(packageRoot, ".runs");
    await mkdir(runs, { recursive: true });
    const summary = await runApprovedPilot({
        outputDirectory: path.join(runs, `live-${randomUUID()}`),
        datasetDirectory: path.join(runs, "abcd", abcdPin.commit),
        allowDownload: args["approved-abcd-download"] === true,
        approvedModelWork: true,
        buildOnly: args["build-only"] === true,
        ...(args.source !== undefined ? { sourceId: args.source } : {}),
        ...(args.sources !== undefined
            ? { sourceIds: args.sources.split(",") }
            : {}),
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (
        summary.builds.some((build) => build.state !== "draft") ||
        summary.returnedPredictions !== summary.scheduledPredictions
    )
        process.exitCode = 1;
}
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    main().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    });
