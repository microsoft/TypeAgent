import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    QualificationError,
    ModelTracker,
    advertisedCopilotCapacity,
    embeddingRuntimeConfig,
    abortable,
    limits,
    ratio,
    safeFailure,
    sha256,
    tsRoot,
} from "./evaluate.mjs";

export const rubricRevision = "9e0b455f4ef0e2ab8f2e582289761153549043fc";
export const rubricSourceSha256 =
    "ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251";
export const templateHashes = Object.freeze({
    standard:
        "fba020ba3d57982efdc9a937c1c01f897b789a608c7f88e60244121f6505e5bc",
    "temporal-reasoning":
        "8d33a5fdd83afeeb4592454a965eab43d1fcb2dedc042d1d3892f4254be6c273",
    "knowledge-update":
        "183a9b3a6197ec620940f610cdc1207201ec98c1113dd633ea685cfc322fafac",
    "single-session-preference":
        "741ee3bcbea7ff5e8ed359acef61d2f8ded3de021bbcff6ee13de455f2e2aa9b",
    abstention:
        "5c0b365a1e1d06db36377c735432b56e122ca3c428f89faf61d43a0d5a7e050b",
});
const allArms = ["no-memory", "raw-episode-rag", "distilled", "full-context"];
const safeId = (value) =>
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(value);
const ensure = (condition, code, category = "schema") => {
    if (!condition) throw new QualificationError(category, code);
};
const save = (file, value) =>
    writeFile(file, JSON.stringify(value, null, 2) + "\n");
const compiled = (relative) =>
    import(pathToFileURL(path.join(tsRoot, ...relative.split("/"))).href);

export function parseRescoreArgs(argv) {
    const options = {
        mode: "prepare",
        cases: [],
        arms: [],
        maxQuestions: 3,
        maxModelCalls: 80,
        timeoutMs: 1_200_000,
    };
    const flags = {
        "--source-run": "sourceRun",
        "--run-directory": "runDirectory",
        "--mode": "mode",
        "--max-questions": "maxQuestions",
        "--max-model-calls": "maxModelCalls",
        "--timeout-ms": "timeoutMs",
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i],
            value = argv[++i];
        ensure(
            typeof value === "string" && !value.startsWith("--"),
            "rescore-missing-option-value",
        );
        if (flag === "--case") options.cases.push(...value.split(","));
        else if (flag === "--arm") options.arms.push(...value.split(","));
        else {
            ensure(Object.hasOwn(flags, flag), "rescore-unknown-option");
            options[flags[flag]] = /questions|calls|timeout/.test(flag)
                ? Number(value)
                : value;
        }
    }
    ensure(options.sourceRun && options.runDirectory, "rescore-required-paths");
    ensure(["prepare", "live"].includes(options.mode), "rescore-invalid-mode");
    ensure(
        options.cases.every(safeId) &&
            options.arms.every((arm) => allArms.includes(arm)),
        "rescore-invalid-selection",
    );
    for (const key of ["maxQuestions", "maxModelCalls", "timeoutMs"])
        ensure(
            Number.isSafeInteger(options[key]) &&
                options[key] >= (key === "maxQuestions" ? 0 : 1),
            "rescore-invalid-limit",
        );
    ensure(options.timeoutMs <= 7_200_000, "rescore-timeout-exceeds-two-hours");
    return {
        ...options,
        sourceRun: path.resolve(options.sourceRun),
        runDirectory: path.resolve(options.runDirectory),
    };
}

export async function loadPinnedRubric() {
    const bytes = await readFile(
        new URL("./longmemeval-rubric.json", import.meta.url),
    );
    const rubric = JSON.parse(bytes.toString("utf8"));
    ensure(
        rubric.revision === rubricRevision &&
            rubric.sourceSha256 === rubricSourceSha256 &&
            rubric.license === "MIT",
        "rescore-rubric-provenance-mismatch",
    );
    ensure(
        Object.keys(rubric.templates ?? {}).length ===
            Object.keys(templateHashes).length,
        "rescore-rubric-template-set-mismatch",
    );
    for (const [name, expected] of Object.entries(templateHashes))
        ensure(
            typeof rubric.templates[name] === "string" &&
                sha256(rubric.templates[name]) === expected,
            "rescore-rubric-template-hash-mismatch",
        );
    return { rubric, bytes, sha256: sha256(bytes) };
}

export function rubricPrompt(rubric, gold, prediction) {
    ensure(
        typeof gold.questionId === "string" &&
            typeof gold.question === "string" &&
            typeof gold.answer === "string" &&
            typeof prediction === "string",
        "rescore-invalid-qa",
    );
    const suppliedType =
        gold.questionType ?? gold.question_type ?? gold.answerType;
    const task = suppliedType ?? "single-session-user";
    let template;
    if (gold.questionId.includes("_abs")) template = "abstention";
    else if (
        [
            "single-session-user",
            "single-session-assistant",
            "multi-session",
        ].includes(task)
    )
        template = "standard";
    else if (
        [
            "temporal-reasoning",
            "knowledge-update",
            "single-session-preference",
        ].includes(task)
    )
        template = task;
    else
        throw new QualificationError(
            "schema",
            "rescore-unsupported-longmemeval-question-type",
        );
    const fields = [gold.question, gold.answer, prediction];
    let index = 0;
    const prompt = rubric.templates[template].replace(
        /\{\}/g,
        () => fields[index++],
    );
    ensure(index === 3, "rescore-invalid-template-placeholders");
    return {
        prompt,
        promptSha256: sha256(prompt),
        template,
        templateSha256: templateHashes[template],
        questionType: task,
        questionTypeSource:
            suppliedType === undefined
                ? "explicit-generic-standard-default; source type absent"
                : "snapshotted-gold",
    };
}

export function parseVerdict(text) {
    ensure(
        typeof text === "string" && /^(yes|no)$/i.test(text.trim()),
        "rescore-invalid-yes-no-verdict",
    );
    return {
        correct: text.trim().toLowerCase() === "yes",
        response: text.trim().toLowerCase(),
    };
}

function within(root, file) {
    const relative = path.relative(root, file);
    return (
        relative === "" ||
        (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
}

async function sourceFile(root, relative) {
    const file = await realpath(path.join(root, relative));
    ensure(within(root, file), "rescore-source-path-escape");
    const bytes = await readFile(file);
    return {
        bytes,
        value: JSON.parse(bytes.toString("utf8")),
        relativePath: relative,
        sha256: sha256(bytes),
    };
}

export async function loadRescoreInputs(options, pinned) {
    const root = await realpath(options.sourceRun);
    const receipt = await sourceFile(root, "receipt.json");
    ensure(
        receipt.value.schemaVersion === 1 &&
            ["complete", "failed"].includes(receipt.value.state) &&
            Array.isArray(receipt.value.cases),
        "rescore-source-run-not-final",
    );
    const manifest = await sourceFile(root, "fixture-manifest.json");
    ensure(Array.isArray(manifest.value), "rescore-invalid-fixture-snapshot");
    const known = new Set(receipt.value.cases.map((entry) => entry.caseId));
    ensure(
        options.cases.every((id) => known.has(id)),
        "rescore-selected-case-missing",
    );
    const selected = receipt.value.cases.filter((entry) =>
        options.cases.length
            ? options.cases.includes(entry.caseId)
            : entry.caseId.startsWith("longmemeval-"),
    );
    ensure(
        selected.length > 0 &&
            selected.every(
                (entry) =>
                    safeId(entry.caseId) &&
                    entry.caseId.startsWith("longmemeval-"),
            ),
        "rescore-only-longmemeval-cases-supported",
    );
    const inputs = [receipt, manifest].map(
        ({ relativePath, sha256: hash }) => ({ relativePath, sha256: hash }),
    );
    const cases = [];
    for (const entry of selected) {
        const results = await sourceFile(
            root,
            path.join(entry.caseId, "results.json"),
        );
        const gold = await sourceFile(
            root,
            path.join(entry.caseId, "gold.evaluator-only.json"),
        );
        const fixture = manifest.value.find(
            (item) => item.caseId === entry.caseId,
        );
        ensure(
            fixture &&
                fixture.provenance?.public === true &&
                typeof fixture.provenance.license === "string" &&
                fixture.provenance.license.trim(),
            "rescore-public-licensed-fixture-required",
        );
        ensure(
            results.value.caseId === entry.caseId &&
                Array.isArray(results.value.questions) &&
                Array.isArray(gold.value.questions),
            "rescore-invalid-case-snapshot",
        );
        const goldHashes = [
            fixture.goldSha256,
            entry.goldSha256,
            results.value.goldSha256,
        ].filter((hash) => hash !== undefined);
        for (const expected of goldHashes)
            ensure(
                typeof expected === "string" &&
                    /^[a-f0-9]{64}$/i.test(expected) &&
                    expected.toLowerCase() === gold.sha256,
                "rescore-gold-sha256-mismatch",
            );
        inputs.push(
            ...[results, gold].map(({ relativePath, sha256: hash }) => ({
                relativePath,
                sha256: hash,
            })),
        );
        const questions = [];
        const ids = new Set();
        const skipped = [];
        for (const q of gold.value.questions.slice(0, options.maxQuestions)) {
            ensure(
                typeof q.questionId === "string" && !ids.has(q.questionId),
                "rescore-duplicate-or-invalid-question-id",
            );
            ids.add(q.questionId);
            const answered = results.value.questions.filter(
                (item) => item.questionId === q.questionId,
            );
            ensure(answered.length <= 1, "rescore-duplicate-source-question");
            if (!answered.length) {
                skipped.push({
                    questionId: q.questionId,
                    reason: "no-retained-source-answers",
                });
                continue;
            }
            ensure(
                answered[0].question === q.question &&
                    Array.isArray(answered[0].arms),
                "rescore-source-question-mismatch",
            );
            const arms = [];
            for (const name of options.arms.length
                ? [...new Set(options.arms)]
                : allArms) {
                const matches = answered[0].arms.filter(
                    (arm) => arm.arm === name,
                );
                ensure(matches.length <= 1, "rescore-duplicate-source-arm");
                const arm = matches[0];
                if (!arm || arm.state !== "complete") {
                    skipped.push({
                        questionId: q.questionId,
                        arm: name,
                        reason: arm?.state ?? "missing-arm",
                    });
                    continue;
                }
                ensure(
                    typeof arm.answer?.answer === "string",
                    "rescore-source-answer-missing",
                );
                const sourceReceiptQuestion = entry.questions?.find(
                    (item) => item.questionId === q.questionId,
                );
                const receiptArm = sourceReceiptQuestion?.arms?.find(
                    (item) => item.arm === name,
                );
                if (receiptArm)
                    ensure(
                        receiptArm.answer?.answer === arm.answer.answer,
                        "rescore-source-receipt-answer-mismatch",
                    );
                arms.push({
                    arm: name,
                    state: "pending",
                    questionId: q.questionId,
                    prediction: {
                        question_id: q.questionId,
                        hypothesis: arm.answer.answer,
                    },
                    predictionSha256: sha256(
                        JSON.stringify({
                            question_id: q.questionId,
                            hypothesis: arm.answer.answer,
                        }),
                    ),
                    goldAnswer: q.answer,
                    goldSha256: gold.sha256,
                    originalJudgment: arm.judgment,
                    originalScores: arm.scores,
                    originalEvidenceEventIds: arm.answer.evidenceEventIds,
                    ...rubricPrompt(pinned.rubric, q, arm.answer.answer),
                });
            }
            questions.push({ questionId: q.questionId, arms });
        }
        cases.push({
            caseId: entry.caseId,
            sourceCaseState: results.value.state,
            goldSha256: gold.sha256,
            goldHashVerification: goldHashes.length
                ? "verified-against-retained-hashes"
                : "computed-now; no-earlier-gold-hash-retained",
            originalArtifactSupport:
                results.value.artifactSupport ?? entry.artifactSupport,
            supportAssessment:
                "preserved, not rescored; answer correctness does not establish evidence support",
            questions,
            skipped,
        });
    }
    return {
        cases,
        inputs,
        sourceReceiptSha256: receipt.sha256,
        sourceRunState: receipt.value.state,
    };
}

export function rescoreMetrics(cases) {
    const metrics = {};
    for (const arm of allArms) {
        const candidates = cases.flatMap((item) =>
            item.questions.flatMap((question) =>
                question.arms.filter((item) => item.arm === arm),
            ),
        );
        const scored = candidates.filter((item) => item.state === "complete");
        metrics[arm] = {
            correctness: ratio(
                scored.filter((item) => item.verdict.correct).length,
                scored.length,
            ),
            scoringCoverage: ratio(scored.length, candidates.length),
            candidates: candidates.length,
        };
    }
    return metrics;
}

async function createJudge(options, signal) {
    process.env.DEBUG = "";
    process.env.ENABLE_MODEL_REQUEST_LOGGING = "false";
    process.env.TYPEAGENT_COPILOT_SDK_LOG_LEVEL = "none";
    const config = await compiled("packages/config/dist/index.js");
    config.loadConfigSync({
        workspaceRoot: tsRoot,
        localPath: path.join(options.runDirectory, "disabled-local.yaml"),
        dotEnvPath: path.join(options.runDirectory, "disabled.env"),
        strict: true,
        populateProcessEnv: true,
    });
    const ai = await compiled("packages/aiclient/dist/index.js");
    process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
    ai.setRuntimeConfig(
        embeddingRuntimeConfig(ai.initRuntimeConfigFromProcessEnv(), "none"),
    );
    const [settingsModule, models, constraints] = await Promise.all([
        compiled("packages/aiclient/dist/copilotSettings.js"),
        compiled("packages/aiclient/dist/copilotModels.js"),
        compiled("packages/aiclient/dist/requestConstraints.js"),
    ]);
    const settings = {
        ...settingsModule.copilotApiSettingsFromConfig("gpt-6-luna"),
        fallbackModels: [],
        enableModelRequestLogging: false,
        timeout: limits.perCallMs,
        maxRetryAttempts: 0,
    };
    let tracker;
    try {
        const capabilitySignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(limits.perCallMs),
        ]);
        const client = await abortable(
            () =>
                models.getCopilotClient({
                    cliPath: settings.cliPath,
                    cliUrl: settings.cliUrl,
                }),
            capabilitySignal,
        );
        const capacity = advertisedCopilotCapacity(
            await abortable(() => client.listModels(), capabilitySignal),
        );
        const model = models.createCopilotChatModel(
            settings,
            { temperature: 0 },
            (_request, response) => tracker?.observeResponse(response),
        );
        tracker = new ModelTracker({
            model,
            identity: "copilot:gpt-6-luna",
            maxCalls: options.maxModelCalls,
            signal,
            constraints: capacity.constraints,
            checkConstraints: constraints.checkSerializedRequestConstraints,
            persist: (calls) =>
                save(
                    path.join(options.runDirectory, "model-calls.json"),
                    calls,
                ),
        });
        return { tracker, capacity, stop: models.stopCopilotClient };
    } catch (error) {
        await abortable(
            () => models.stopCopilotClient(),
            AbortSignal.timeout(10_000),
        );
        throw error;
    }
}

export async function rescore(options, injections = {}) {
    const sourceRoot = await realpath(options.sourceRun);
    const outputParent = await realpath(path.dirname(options.runDirectory));
    ensure(
        !within(
            sourceRoot,
            path.join(outputParent, path.basename(options.runDirectory)),
        ),
        "rescore-output-must-be-outside-source-run",
    );
    await mkdir(options.runDirectory);
    const receiptFile = path.join(options.runDirectory, "receipt.json");
    const receipt = {
        schemaVersion: 1,
        state: "running",
        startedAt: new Date().toISOString(),
        mode: options.mode,
        sourceRun: sourceRoot,
        judge: "Copilot gpt-6-luna; NONofficial model, same-model-role/nonindependent assessment",
        scope: "answer correctness only under pinned official LongMemEval prompt; not official benchmark scores or evidence-support rescoring",
        deviations: [
            "Judge is not the official GPT-4o judge.",
            "Strict yes/no parser instead of upstream substring matching.",
            "Existing tracked conservative request admission and 8192 output reservation; no provider max_tokens cap.",
        ],
        bounds: {
            maxQuestionsPerCase: options.maxQuestions,
            maxModelCalls: options.maxModelCalls,
            timeoutMs: options.timeoutMs,
            perCallMs: limits.perCallMs,
        },
        cases: [],
    };
    const started = performance.now();
    let peakRss = process.memoryUsage().rss;
    const controller = new AbortController();
    const cancel = () =>
        controller.abort(
            new QualificationError("cancelled", "rescore-process-cancelled"),
        );
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    const timer = setTimeout(
        () =>
            controller.abort(
                new QualificationError("timeout", "rescore-global-timeout"),
            ),
        options.timeoutMs,
    );
    const sample = setInterval(() => {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 50);
    let judge;
    await save(receiptFile, receipt);
    try {
        const pinned = await loadPinnedRubric();
        receipt.rubric = {
            revision: pinned.rubric.revision,
            sourceUrl: pinned.rubric.sourceUrl,
            sourceSha256: pinned.rubric.sourceSha256,
            snapshotSha256: pinned.sha256,
            templateHashes,
            license: pinned.rubric.license,
        };
        await writeFile(
            path.join(options.runDirectory, "rubric.snapshot.json"),
            pinned.bytes,
        );
        const loaded = await abortable(
            () => loadRescoreInputs(options, pinned),
            controller.signal,
        );
        Object.assign(receipt, loaded);
        await mkdir(path.join(options.runDirectory, "prompts"));
        for (const item of receipt.cases)
            for (const [index, question] of item.questions.entries())
                for (const arm of question.arms) {
                    arm.promptFile = path.join(
                        "prompts",
                        `${item.caseId}.${index}.${arm.arm}.txt`,
                    );
                    await writeFile(
                        path.join(options.runDirectory, arm.promptFile),
                        arm.prompt,
                    );
                }
        receipt.predictionFiles = [];
        for (const item of receipt.cases)
            for (const arm of allArms) {
                const predictions = item.questions.flatMap((question) =>
                    question.arms
                        .filter((entry) => entry.arm === arm)
                        .map((entry) => JSON.stringify(entry.prediction)),
                );
                const filename = `predictions.${item.caseId}.${arm}.jsonl`;
                const bytes = predictions.length
                    ? predictions.join("\n") + "\n"
                    : "";
                await writeFile(
                    path.join(options.runDirectory, filename),
                    bytes,
                );
                receipt.predictionFiles.push({
                    filename,
                    arm,
                    predictions: predictions.length,
                    sha256: sha256(bytes),
                });
            }
        await save(
            path.join(options.runDirectory, "results.json"),
            receipt.cases,
        );
        const candidates = receipt.cases.flatMap((item) =>
            item.questions.flatMap((question) => question.arms),
        );
        if (options.mode === "live" && candidates.length) {
            judge = await abortable(
                () =>
                    (injections.createJudge ?? createJudge)(
                        options,
                        controller.signal,
                    ),
                controller.signal,
            );
            receipt.modelCapacity = judge.capacity;
            receipt.actualJudgeIdentity = judge.tracker.identity;
            for (const arm of candidates) {
                const completion = await judge.tracker.complete(
                    "rescore:official-longmemeval-rubric",
                    arm.prompt,
                );
                arm.verdict = parseVerdict(completion.data);
                arm.model = structuredClone(judge.tracker.calls.at(-1));
                arm.state = "complete";
                await save(
                    path.join(options.runDirectory, "results.json"),
                    receipt.cases,
                );
            }
        }
        receipt.state = options.mode === "prepare" ? "prepared" : "complete";
    } catch (error) {
        controller.abort(error);
        receipt.state = "failed";
        receipt.failure = safeFailure(error);
    } finally {
        if (judge) {
            try {
                await abortable(
                    () => judge.stop(),
                    AbortSignal.timeout(10_000),
                );
            } catch (error) {
                receipt.state = "failed";
                receipt.cleanupFailure = safeFailure(error);
            }
        }
        clearTimeout(timer);
        clearInterval(sample);
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
        receipt.metrics = rescoreMetrics(receipt.cases);
        receipt.modelCalls = judge?.tracker.calls.length ?? 0;
        receipt.elapsedMs = performance.now() - started;
        receipt.peakObservedRssBytes = Math.max(
            peakRss,
            process.memoryUsage().rss,
        );
        receipt.completedAt = new Date().toISOString();
        await save(
            path.join(options.runDirectory, "results.json"),
            receipt.cases,
        );
        await save(receiptFile, receipt);
    }
    return receipt;
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        const result = await rescore(parseRescoreArgs(process.argv.slice(2)));
        console.log(
            JSON.stringify({
                state: result.state,
                failure: result.failure,
                modelCalls: result.modelCalls,
                metrics: result.metrics,
            }),
        );
        process.exitCode = result.state === "failed" ? 1 : 0;
    } catch (error) {
        console.error(
            JSON.stringify({ state: "failed", failure: safeFailure(error) }),
        );
        process.exitCode = 1;
    }
}
