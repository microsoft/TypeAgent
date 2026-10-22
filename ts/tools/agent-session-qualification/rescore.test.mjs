// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import {
    mkdir,
    writeFile,
    readFile,
    rm,
    readdir,
    stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { ModelTracker, limits, sha256, tsRoot, ratio } from "./evaluate.mjs";
import {
    loadPinnedRubric,
    loadRescoreInputs,
    parseRescoreArgs,
    parseVerdict,
    rescore,
    rescoreMetrics,
    rubricPrompt,
    rubricRevision,
    templateHashes,
} from "./rescore.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const json = (file, value) =>
    writeFile(file, JSON.stringify(value, null, 2) + "\n");
const arms = ["no-memory", "raw-episode-rag", "distilled", "full-context"];

async function fixture(t) {
    const root = path.join(directory, `.rescore-test-${randomUUID()}`);
    await mkdir(root);
    t.after(() => rm(root, { recursive: true, force: true }));
    const sourceRun = path.join(root, "original-run");
    const caseId = "longmemeval-oracle-test";
    await mkdir(sourceRun);
    await mkdir(path.join(sourceRun, caseId));
    const gold = {
        questions: [
            {
                questionId: "original-question-051",
                question:
                    "Question date: 2024/02/20 (Tue) 12:00\nWhat broke first?",
                answer: "The charging circuit.",
                answerType: "single-session-user",
                requiredTerms: [
                    "Evaluator-only term, not an extra grading requirement.",
                ],
                evidenceEventIds: ["original-event"],
            },
        ],
    };
    const prediction =
        "The charging circuit broke first. The workshop replaced the whole module and it now works.";
    const goldFile = path.join(sourceRun, caseId, "gold.evaluator-only.json");
    await json(goldFile, gold);
    const goldHash = sha256(await readFile(goldFile));
    const support = {
        label: "original artifact-support/self-model role",
        assessments: Array.from({ length: 8 }, (_, i) => ({
            memoryId: `memory-${i}`,
            supported: i < 7,
            criticalErrors: i < 7 ? [] : ["Unsupported negative assertion."],
        })),
        supported: ratio(7, 8),
    };
    const results = {
        caseId,
        state: "complete",
        goldSha256: goldHash,
        artifactSupport: support,
        questions: [
            {
                questionId: gold.questions[0].questionId,
                question: gold.questions[0].question,
                arms: arms.map((arm) => ({
                    arm,
                    state: "complete",
                    answer: {
                        answer: prediction,
                        evidenceEventIds: ["original-event"],
                    },
                    judgment: {
                        assessment:
                            arm === "raw-episode-rag" ? "correct" : "partial",
                        reason: "Previous custom judge finding; do not reuse as rubric.",
                    },
                    scores: { suppliedEvidenceSupport: ratio(1, 1) },
                })),
            },
        ],
    };
    await json(path.join(sourceRun, caseId, "results.json"), results);
    await json(path.join(sourceRun, "receipt.json"), {
        schemaVersion: 1,
        state: "complete",
        mode: "live",
        cases: [results],
    });
    await json(path.join(sourceRun, "fixture-manifest.json"), [
        {
            caseId,
            goldSha256: goldHash,
            provenance: {
                public: true,
                license: "MIT",
                sourceUrl: "https://example.org/synthetic-test-only",
            },
        },
    ]);
    await writeFile(
        path.join(sourceRun, "keep-original-prompts.txt"),
        "Original prompts must never change.\n",
    );
    return {
        root,
        sourceRun,
        caseId,
        gold,
        goldFile,
        results,
        prediction,
        support,
        goldHash,
    };
}

const options = (f, changes = {}) => ({
    sourceRun: f.sourceRun,
    runDirectory: path.join(f.root, "new-rescore"),
    mode: "prepare",
    cases: [],
    arms: [],
    maxQuestions: 3,
    maxModelCalls: 80,
    timeoutMs: 30_000,
    ...changes,
});

async function fingerprint(root) {
    const result = [];
    for (const relative of (await readdir(root, { recursive: true })).sort()) {
        const file = path.join(root, relative),
            info = await stat(file);
        if (info.isFile())
            result.push({
                relative,
                sha256: sha256(await readFile(file)),
                mtimeMs: info.mtimeMs,
            });
    }
    return result;
}

function controlledJudge(output = "yes", observed = []) {
    return async (settings, signal) => {
        const { checkSerializedRequestConstraints } = await import(
            pathToFileURL(
                path.join(
                    tsRoot,
                    "packages",
                    "aiclient",
                    "dist",
                    "requestConstraints.js",
                ),
            ).href
        );
        const tracker = new ModelTracker({
            model: {
                completionSettings: { temperature: 0 },
                complete: async (prompt) => {
                    observed.push(prompt);
                    return { success: true, data: output };
                },
            },
            identity: "controlled-offline-test-judge-not-a-live-model",
            maxCalls: settings.maxModelCalls,
            signal,
            checkConstraints: checkSerializedRequestConstraints,
            persist: (calls) =>
                json(
                    path.join(settings.runDirectory, "model-calls.json"),
                    calls,
                ),
        });
        return {
            tracker,
            capacity: { source: "controlled-offline-test" },
            stop: async () => {},
        };
    };
}

test("rescore CLI defaults to prepare-only, bounds work, and source/selection errors are explicit", () => {
    const args = ["--source-run", "existing", "--run-directory", "new"];
    assert.equal(parseRescoreArgs(args).mode, "prepare");
    assert.equal(parseRescoreArgs(args).maxModelCalls, 80);
    assert.deepEqual(
        parseRescoreArgs([
            ...args,
            "--case",
            "one,two",
            "--arm",
            "distilled",
            "--arm",
            "full-context",
        ]).arms,
        ["distilled", "full-context"],
    );
    for (const additional of [
        ["--mode", "unknown"],
        ["--max-model-calls", "0"],
        ["--max-questions", "-1"],
        ["--timeout-ms", "7200001"],
        ["--arm", "unknown"],
        ["--case", "..\\escape"],
        ["--provider", "other"],
    ])
        assert.throws(() => parseRescoreArgs([...args, ...additional]));
});

test("vendored official rubric strings match pinned upstream hashes and retain the MIT notice", async () => {
    const pinned = await loadPinnedRubric();
    assert.equal(pinned.rubric.revision, rubricRevision);
    assert.match(pinned.rubric.licenseNotice, /Copyright \(c\) 2024 Di Wu/);
    assert.match(
        pinned.rubric.sourceUrl,
        /9e0b455f4ef0e2ab8f2e582289761153549043fc/,
    );
    for (const [name, expected] of Object.entries(templateHashes))
        assert.equal(sha256(pinned.rubric.templates[name]), expected);
    assert.match(
        pinned.rubric.templates.standard,
        /yes if the response contains the correct answer/,
    );
    assert.match(
        pinned.rubric.templates.standard,
        /only contains a subset.*answer no/,
    );
});

test("rubric is generic containment/equivalence, with exact task-specific temporal/update/preference/abstention routing", async () => {
    const { rubric } = await loadPinnedRubric();
    const gold = {
        questionId: "arbitrary-original-id",
        question: "Question date: 2024/01/01\nA question?",
        answer: "A reference.",
        answerType: "single-session-user",
        requiredTerms: ["must-never-be-added-to-prompt"],
    };
    const prompt = rubricPrompt(
        rubric,
        gold,
        "A reference. Additional noncontradictory detail.",
    );
    assert.equal(prompt.template, "standard");
    assert.match(prompt.prompt, /Additional noncontradictory detail/);
    assert.ok(!prompt.prompt.includes("must-never-be-added-to-prompt"));
    assert.ok(!prompt.prompt.includes("unsupported by reference"));
    assert.ok(prompt.prompt.includes(gold.question));
    for (const type of [
        "temporal-reasoning",
        "knowledge-update",
        "single-session-preference",
    ])
        assert.equal(
            rubricPrompt(rubric, { ...gold, answerType: type }, "Response")
                .template,
            type,
        );
    assert.equal(
        rubricPrompt(
            rubric,
            { ...gold, questionId: "original_abs_id" },
            "Unknown.",
        ).template,
        "abstention",
    );
    assert.match(
        rubricPrompt(rubric, { ...gold, answerType: undefined }, "Response")
            .questionTypeSource,
        /source type absent/,
    );
    assert.throws(
        () =>
            rubricPrompt(
                rubric,
                { ...gold, answerType: "unrecognized" },
                "Response",
            ),
        /unsupported-longmemeval-question-type/,
    );
    const braces = rubricPrompt(
        rubric,
        { ...gold, question: "Literal {} stays {}" },
        "Candidate {} remains.",
    );
    assert.ok(braces.prompt.includes("Literal {} stays {}"));
    assert.ok(braces.prompt.includes("Candidate {} remains."));
});

test("strict yes/no verdicts do not mistake negation, explanations or JSON for correct labels", () => {
    assert.deepEqual(parseVerdict(" YES\n"), {
        correct: true,
        response: "yes",
    });
    assert.deepEqual(parseVerdict("no"), { correct: false, response: "no" });
    for (const text of [
        "not yes",
        "yes but no",
        '{"correct":true}',
        "no, yes appears in the answer",
        "",
    ])
        assert.throws(() => parseVerdict(text));
});

test("prepare-only rescoring preserves every original byte/mtime, prediction ID, date, gold hash and unsupported-artifact finding", async (t) => {
    const f = await fixture(t);
    const before = await fingerprint(f.sourceRun);
    let initialized = false;
    const receipt = await rescore(options(f), {
        createJudge: async () => {
            initialized = true;
            throw new Error("must stay offline");
        },
    });
    assert.equal(receipt.state, "prepared", JSON.stringify(receipt));
    assert.equal(initialized, false);
    assert.equal(receipt.modelCalls, 0);
    assert.deepEqual(await fingerprint(f.sourceRun), before);
    const caseResult = receipt.cases[0];
    assert.equal(caseResult.goldSha256, f.goldHash);
    assert.deepEqual(caseResult.originalArtifactSupport, f.support);
    const retained = caseResult.questions[0].arms;
    assert.equal(new Set(retained.map((arm) => arm.promptSha256)).size, 1);
    for (const arm of retained) {
        assert.equal(
            arm.prediction.question_id,
            f.gold.questions[0].questionId,
        );
        assert.equal(arm.prediction.hypothesis, f.prediction);
        assert.equal(
            await readFile(
                path.join(f.root, "new-rescore", arm.promptFile),
                "utf8",
            ),
            arm.prompt,
        );
        assert.ok(!arm.prompt.includes("Previous custom judge finding"));
        assert.ok(!arm.prompt.includes("Unsupported negative assertion."));
    }
    assert.deepEqual(receipt.metrics.distilled.correctness, ratio(0, 0));
    assert.deepEqual(receipt.metrics.distilled.scoringCoverage, ratio(0, 1));
    assert.match(receipt.judge, /NONofficial.*nonindependent/);
    assert.deepEqual(
        JSON.parse(
            await readFile(
                path.join(
                    f.root,
                    "new-rescore",
                    `predictions.${f.caseId}.distilled.jsonl`,
                ),
                "utf8",
            ),
        ),
        {
            question_id: f.gold.questions[0].questionId,
            hypothesis: f.prediction,
        },
    );
    await assert.rejects(rescore(options(f)), /EEXIST/);
});

test("controlled rescoring treats identical predictions symmetrically without overriding artifact support or original judgments", async (t) => {
    const f = await fixture(t),
        observed = [];
    const before = await fingerprint(f.sourceRun);
    const receipt = await rescore(options(f, { mode: "live" }), {
        createJudge: controlledJudge("yes", observed),
    });
    assert.equal(receipt.state, "complete", JSON.stringify(receipt));
    assert.equal(receipt.modelCalls, 4);
    assert.equal(new Set(observed).size, 1);
    assert.deepEqual(receipt.metrics.distilled.correctness, ratio(1, 1));
    assert.deepEqual(
        receipt.metrics["full-context"].scoringCoverage,
        ratio(1, 1),
    );
    assert.equal(
        receipt.cases[0].questions[0].arms.find(
            (arm) => arm.arm === "distilled",
        ).originalJudgment.assessment,
        "partial",
    );
    assert.deepEqual(
        receipt.cases[0].originalArtifactSupport.supported,
        ratio(7, 8),
    );
    assert.equal(
        receipt.cases[0].originalArtifactSupport.assessments[7].supported,
        false,
    );
    assert.deepEqual(await fingerprint(f.sourceRun), before);
});

test("gold tampering is rejected before judge initialization and original hashes remain inspectable", async (t) => {
    const f = await fixture(t);
    const changed = structuredClone(f.gold);
    changed.questions[0].answer = "Tampered answer.";
    await json(f.goldFile, changed);
    let initialized = false;
    const receipt = await rescore(options(f, { mode: "live" }), {
        createJudge: async () => {
            initialized = true;
            throw new Error("must not call");
        },
    });
    assert.equal(receipt.state, "failed");
    assert.equal(initialized, false);
    assert.deepEqual(receipt.failure, {
        category: "schema",
        code: "rescore-gold-sha256-mismatch",
    });
});

test("source-run output nesting, nonfinal source state, unknown cases and receipt/prediction mismatch fail explicitly", async (t) => {
    const f = await fixture(t),
        pinned = await loadPinnedRubric();
    await assert.rejects(
        rescore(
            options(f, { runDirectory: path.join(f.sourceRun, "new-rescore") }),
        ),
        /outside-source-run/,
    );
    await assert.rejects(
        loadRescoreInputs(options(f, { cases: ["missing"] }), pinned),
        /selected-case-missing/,
    );
    const rootReceipt = JSON.parse(
        await readFile(path.join(f.sourceRun, "receipt.json"), "utf8"),
    );
    rootReceipt.state = "running";
    await json(path.join(f.sourceRun, "receipt.json"), rootReceipt);
    await assert.rejects(
        loadRescoreInputs(options(f), pinned),
        /source-run-not-final/,
    );
    rootReceipt.state = "complete";
    rootReceipt.cases[0].questions[0].arms[0].answer.answer =
        "Different receipt prediction.";
    await json(path.join(f.sourceRun, "receipt.json"), rootReceipt);
    await assert.rejects(
        loadRescoreInputs(options(f), pinned),
        /receipt-answer-mismatch/,
    );
});

test("budgets produce a failed partial receipt, while invalid output is never silently graded", async (t) => {
    const f = await fixture(t);
    const bounded = await rescore(
        options(f, { mode: "live", maxModelCalls: 1 }),
        { createJudge: controlledJudge() },
    );
    assert.equal(bounded.state, "failed");
    assert.equal(bounded.failure.category, "budget");
    assert.equal(bounded.modelCalls, 1);
    assert.deepEqual(bounded.metrics["no-memory"].correctness, ratio(1, 1));
    assert.deepEqual(bounded.metrics.distilled.correctness, ratio(0, 0));
    const invalid = await rescore(
        options(f, {
            mode: "live",
            runDirectory: path.join(f.root, "invalid-output"),
        }),
        { createJudge: controlledJudge("not yes") },
    );
    assert.equal(invalid.state, "failed");
    assert.equal(invalid.failure.code, "rescore-invalid-yes-no-verdict");
    assert.deepEqual(invalid.metrics["no-memory"].correctness, ratio(0, 0));
});

test("global deadlines and provider failures save safe failure receipts without raw secrets", async (t) => {
    const f = await fixture(t);
    const timeout = await rescore(options(f, { mode: "live", timeoutMs: 20 }), {
        createJudge: async () => new Promise(() => {}),
    });
    assert.equal(timeout.state, "failed");
    assert.equal(timeout.failure.category, "timeout");
    const failed = await rescore(
        options(f, {
            mode: "live",
            runDirectory: path.join(f.root, "safe-provider-failure"),
        }),
        {
            createJudge: async () => {
                throw new Error(
                    "401 auth secret-token https://private-provider.invalid",
                );
            },
        },
    );
    assert.equal(failed.state, "failed");
    assert.equal(failed.failure.category, "auth");
    const retained = await readFile(
        path.join(f.root, "safe-provider-failure", "receipt.json"),
        "utf8",
    );
    assert.ok(!retained.includes("secret-token"));
    assert.ok(!retained.includes("private-provider"));
});

test("empty and capacity-blocked answer denominators are actual counts, never vacuous correctness", async (t) => {
    assert.deepEqual(rescoreMetrics([]).distilled.correctness, ratio(0, 0));
    const f = await fixture(t);
    const blocked = structuredClone(f.results);
    blocked.questions[0].arms = [
        { arm: "full-context", state: "capacity-blocked" },
    ];
    await json(path.join(f.sourceRun, f.caseId, "results.json"), blocked);
    const receipt = await rescore(options(f, { arms: ["full-context"] }));
    assert.equal(receipt.state, "prepared");
    assert.deepEqual(receipt.metrics["full-context"].correctness, ratio(0, 0));
    assert.equal(receipt.cases[0].skipped[0].reason, "capacity-blocked");
});
