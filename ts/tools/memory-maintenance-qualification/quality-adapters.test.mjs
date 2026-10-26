// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { identity, sha256 } from "./quality-contract.mjs";
import { main } from "./quality-cli.mjs";
import {
    publicPins,
    lmeCategories,
    prepareLongMemEval,
    exportLongMemEvalHypotheses,
    summarizeLongMemEvalLabels,
    prepareQed,
    validateQedReviews,
} from "./quality-adapters.mjs";

const digest = "a".repeat(64);
const source = (pin, path) => ({ ...pin, path, sha256: digest });

function lmeFixture() {
    const rows = lmeCategories.flatMap((category) =>
        Array.from({ length: 9 }, (_, i) => ({
            question_id: `${category}-${i}${category === "abstention" ? "_abs" : ""}`,
            question_type:
                category === "abstention" ? "single-session-user" : category,
            question: `Unit-only query ${i}`,
            answer: "EVALUATOR_REFERENCE_SENTINEL",
            question_date: "2024/03/02 (Sat) 12:00",
            haystack_session_ids: ["later", "earlier"],
            haystack_dates: [
                "2024/03/01 (Fri) 10:00",
                "2024/02/28 (Wed) 09:00",
            ],
            haystack_sessions: [
                [
                    {
                        role: "user",
                        content: "An original unit test history.",
                        has_answer: true,
                    },
                ],
                [
                    {
                        role: "assistant",
                        content: "An earlier unit test history.",
                        has_answer: false,
                    },
                ],
            ],
            answer_session_ids: ["later"],
            extra_official_metadata: { preserve: true },
        })),
    );
    const plan = {
        provenance: source(
            publicPins.longMemEval,
            "data/longmemeval_oracle.json",
        ),
        seed: "frozen-unit-seed",
        quotas: Object.fromEntries(
            lmeCategories.map((c, i) => [c, i === 0 ? 8 : 7]),
        ),
    };
    return { rows, plan };
}

function qedFixture() {
    const articles = [
        {
            type: "text",
            altids: { itemid: "unit-article-1" },
            version: 2,
            firstcreated: "2024-01-01T10:00:00Z",
            versioncreated: "2024-01-02T10:00:00Z",
            headline: "Unit fixture only",
            body_nitf:
                "<body><p>A synthetic source for adapter tests.</p></body>",
            usageterms: "Synthetic unit text, not AP news",
        },
    ];
    const questions = (kind) =>
        Array.from({ length: 23 }, (_, i) => ({
            question_id: `${kind}-${i}`,
            question_text: `Unit-only ${kind} query ${i}`,
            assertions: [
                {
                    statement: "EVALUATOR_ASSERTION_SENTINEL",
                    score: 10,
                    source_count: 1,
                    rank: 1,
                    validation: { is_valid: true },
                    supporting_assertions: [
                        { statement: "Retain nested metadata" },
                    ],
                },
            ],
            claims: [
                {
                    statement: "EVALUATOR_CLAIM_SENTINEL",
                    sources: [
                        {
                            source_id: "chunk-short-id",
                            text: "Keep original toolkit chunk IDs, not assumed AP itemids",
                        },
                    ],
                },
            ],
        }));
    const plan = {
        provenance: source(
            publicPins.benchmarkQed,
            "datasets/AP_news/generated_questions_v2",
        ),
        seed: "unit-frozen",
        topicViewsHash: digest,
        corpusInventoryHash: digest,
        localSha256: digest,
        globalSha256: digest,
        termsAccepted: true,
        inputScope: "adapter-test-fixture",
        expectedArticles: 1,
    };
    plan.provenance.sha256 = identity({
        corpusInventoryHash: plan.corpusInventoryHash,
        localSha256: plan.localSha256,
        globalSha256: plan.globalSha256,
    });
    return {
        articles,
        local: questions("local"),
        global: questions("global"),
        plan,
    };
}

test("full cleaned LongMemEval preparation retains all 500 cases and isolates official gold", () => {
    const { rows, plan } = lmeFixture();
    const fullRows = Array.from({ length: 500 }, (_, index) => ({
        ...rows[index % rows.length],
        question_id: `full-${index}${rows[index % rows.length].question_id.endsWith("_abs") ? "_abs" : ""}`,
    }));
    const fullPlan = {
        ...plan,
        scope: "full500",
        provenance: { ...plan.provenance, path: "longmemeval_s_cleaned.json" },
    };
    const result = prepareLongMemEval(fullRows, fullPlan);
    assert.equal(result.construction.length, 500);
    assert.equal(result.evaluatorOnly.references.length, 500);
    assert.equal(
        result.manifest.benchmark,
        "LongMemEval full 500-question suite",
    );
    assert.equal(
        Object.values(result.manifest.quotas).reduce((a, b) => a + b, 0),
        500,
    );
    assert.ok(
        !JSON.stringify(result.construction).includes(
            "EVALUATOR_REFERENCE_SENTINEL",
        ),
    );
    assert.deepEqual(
        result.manifest,
        prepareLongMemEval([...fullRows].reverse(), fullPlan).manifest,
    );
    assert.throws(
        () => prepareLongMemEval(fullRows.slice(1), fullPlan),
        /all 500/,
    );
    const repeated = structuredClone(fullRows);
    repeated[0].haystack_session_ids[1] = repeated[0].haystack_session_ids[0];
    repeated[0].haystack_sessions[0][0].content = "";
    const packet = prepareLongMemEval(repeated, fullPlan).construction.find(
        (row) => row.id === repeated[0].question_id,
    );
    assert.equal(packet.sessions.length, 2);
    assert.equal(packet.sessions[0].id, packet.sessions[1].id);
    assert.notEqual(packet.sessions[0].position, packet.sessions[1].position);
    assert.equal(packet.sessions[0].turns[0].content, "");
    const conflicts = structuredClone(fullRows);
    conflicts[0].question_date = "2024/02/27 (Tue) 00:00";
    assert.throws(
        () => prepareLongMemEval(conflicts, fullPlan),
        /Future-message/,
    );
    const officialHistory = prepareLongMemEval(conflicts, {
        ...fullPlan,
        historyPolicy: "official-supplied",
    });
    assert.equal(officialHistory.manifest.timestampConflicts.length, 2);
    assert.equal(officialHistory.construction.length, 500);
});

test("LongMemEval selects a deterministic 50-question seven-stratum diagnostic", () => {
    const f = lmeFixture();
    const prepared = prepareLongMemEval(f.rows, f.plan);
    assert.equal(prepared.construction.length, 50);
    assert.equal(prepared.evaluatorOnly.references.length, 50);
    assert.deepEqual(
        prepared,
        prepareLongMemEval([...f.rows].reverse(), f.plan),
    );
    assert.equal(
        prepared.manifest.originalRowHashes.filter(
            (r) => r.category === "abstention",
        ).length,
        7,
    );
    assert.deepEqual(prepared.manifest.quotas, f.plan.quotas);
});

test("official history order, cutoff and metadata are preserved; gold and questions never enter construction", () => {
    const f = lmeFixture();
    const prepared = prepareLongMemEval(f.rows, f.plan);
    const packet = prepared.construction[0];
    assert.equal(packet.cutoff, "2024/03/02 (Sat) 12:00");
    assert.deepEqual(
        packet.sessions.map((s) => s.id),
        ["later", "earlier"],
    );
    assert.equal(packet.sessions[0].date, "2024/03/01 (Fri) 10:00");
    const construction = JSON.stringify(prepared.construction);
    for (const forbidden of [
        "has_answer",
        "answer_session_ids",
        "EVALUATOR_REFERENCE_SENTINEL",
        "Unit-only query",
        "extra_official_metadata",
    ])
        assert.ok(!construction.includes(forbidden));
    const original = prepared.evaluatorOnly.references[0];
    assert.deepEqual(original.extra_official_metadata, { preserve: true });
    assert.equal(original.haystack_sessions[0][0].has_answer, true);
    assert.deepEqual(
        original,
        f.rows.find((r) => r.question_id === original.question_id),
    );
    assert.equal(prepared.readerOnly.evaluatorOnly, true);
    packet.sessions[0].turns[0].content = "changed";
    assert.notEqual(f.rows[0].haystack_sessions[0][0].content, "changed");
});

for (const [name, mutate] of [
    [
        "future message",
        (f) => (f.rows[0].haystack_dates[0] = "2025-01-01T00:00:00Z"),
    ],
    ["malformed date", (f) => (f.rows[0].question_date = "not a date")],
    ["mismatched history", (f) => f.rows[0].haystack_dates.pop()],
    ["duplicate questions", (f) => f.rows.push(f.rows[0])],
    [
        "duplicate sessions",
        (f) => (f.rows[0].haystack_session_ids[1] = "later"),
    ],
    [
        "unknown evidence session",
        (f) => f.rows[0].answer_session_ids.push("unknown"),
    ],
    ["unknown category", (f) => (f.rows[0].question_type = "invented")],
    ["missing provenance", (f) => delete f.plan.provenance.sha256],
    ["unpinned provenance", (f) => (f.plan.provenance.revision = "main")],
    ["wrong count", (f) => f.plan.quotas.abstention--],
    [
        "insufficient stratum",
        (f) =>
            (f.rows = f.rows.filter(
                (r) => r.question_type !== "knowledge-update",
            )),
    ],
])
    test(`LongMemEval rejects ${name}`, () => {
        const f = lmeFixture();
        mutate(f);
        assert.throws(() => prepareLongMemEval(f.rows, f.plan));
    });

test("official hypothesis JSONL export has only question_id/hypothesis, with no fallback answers", () => {
    const f = lmeFixture();
    const prepared = prepareLongMemEval(f.rows, f.plan);
    const attempts = prepared.manifest.originalRowHashes.map((r) => ({
        question_id: r.id,
        status: "ok",
        hypothesis: "UNIT TEST FORMAT ONLY",
    }));
    const lines = exportLongMemEvalHypotheses(prepared, attempts)
        .trim()
        .split("\n")
        .map(JSON.parse);
    assert.equal(lines.length, 50);
    assert.deepEqual(Object.keys(lines[0]), ["question_id", "hypothesis"]);
    assert.throws(
        () => exportLongMemEvalHypotheses(prepared, attempts.slice(1)),
        /Absent outputs/,
    );
    assert.throws(
        () => exportLongMemEvalHypotheses(prepared, [...attempts, attempts[0]]),
        /duplicate/,
    );
    attempts[0].status = "failed";
    assert.throws(
        () => exportLongMemEvalHypotheses(prepared, attempts),
        /Failed\/missing/,
    );
    attempts[0].status = "ok";
    attempts[0].hypothesis = "";
    assert.throws(
        () => exportLongMemEvalHypotheses(prepared, attempts),
        /required text/,
    );
});

test("official LongMemEval nested autoeval_label format reports missing scores by stratum", () => {
    const f = lmeFixture();
    const prepared = prepareLongMemEval(f.rows, f.plan);
    const labels = prepared.manifest.originalRowHashes
        .slice(0, 5)
        .map((r, i) => ({
            question_id: r.id,
            autoeval_label: { model: "official-unit-format", label: i !== 0 },
        }));
    const result = summarizeLongMemEvalLabels(prepared, labels);
    assert.equal(result.total.correct.numerator, 4);
    assert.equal(result.total.correct.denominator, 50);
    assert.equal(result.total.missing, 45);
    assert.equal(result.categories.abstention.missing, 7);
    assert.throws(
        () =>
            summarizeLongMemEvalLabels(prepared, [
                {
                    question_id: "unknown",
                    autoeval_label: { model: "x", label: true },
                },
            ]),
        /Unknown/,
    );
    labels[0].autoeval_label.label = 2;
    assert.throws(
        () => summarizeLongMemEvalLabels(prepared, labels),
        /boolean/,
    );
});

test("AP/QED preparation freezes 20 local + 20 global with half heldout, preserving official assertion metadata", () => {
    const f = qedFixture();
    const prepared = prepareQed(f.articles, f.local, f.global, f.plan);
    assert.equal(prepared.manifest.questions.length, 40);
    for (const kind of ["local", "global"]) {
        for (const split of ["development", "holdout"]) {
            assert.equal(
                prepared.manifest.questions.filter(
                    (q) => q.kind === kind && q.split === split,
                ).length,
                10,
            );
        }
    }
    const question = prepared.evaluatorOnly.questions[0];
    assert.deepEqual(
        question.original,
        f.local.find((q) => q.question_id === question.original.question_id),
    );
    assert.equal(
        prepared.evaluatorOnly.reviewStatus,
        "pending-source-backed-independent-human-review",
    );
    assert.deepEqual(
        prepared,
        prepareQed(
            f.articles,
            [...f.local].reverse(),
            [...f.global].reverse(),
            f.plan,
        ),
    );
});

test("AP construction packet contains original source body/revision/dates, no question/assertion/claim fields", () => {
    const f = qedFixture();
    const prepared = prepareQed(f.articles, f.local, f.global, f.plan);
    const packet = JSON.stringify(prepared.construction);
    for (const forbidden of [
        "EVALUATOR_",
        "question_text",
        "assertions",
        "claims",
        "references",
    ])
        assert.ok(!packet.includes(forbidden));
    assert.equal(
        prepared.construction.documents[0].body_nitf,
        f.articles[0].body_nitf,
    );
    assert.equal(prepared.construction.documents[0].revision, "2");
    assert.equal(
        prepared.construction.documents[0].sourceHash,
        identity(f.articles[0]),
    );
    assert.equal(prepared.manifest.inputScope, "adapter-test-fixture");
});

for (const [name, mutate] of [
    ["missing legal acceptance", (f) => (f.plan.termsAccepted = false)],
    ["unfrozen topic views", (f) => delete f.plan.topicViewsHash],
    ["missing inventory", (f) => delete f.plan.corpusInventoryHash],
    ["wrong corpus count", (f) => (f.plan.expectedArticles = 2)],
    ["test subset as official corpus", (f) => delete f.plan.inputScope],
    ["missing body", (f) => delete f.articles[0].body_nitf],
    ["missing revision", (f) => delete f.articles[0].version],
    [
        "duplicate documents",
        (f) => {
            f.articles.push(f.articles[0]);
            f.plan.expectedArticles = 2;
        },
    ],
    ["too few questions", (f) => (f.local = f.local.slice(0, 19))],
    ["duplicate questions", (f) => f.local.push(f.local[0])],
    ["missing assertions", (f) => (f.local[0].assertions = [])],
    ["invalid importance score", (f) => (f.local[0].assertions[0].score = 11)],
    ["invalid rank", (f) => (f.global[0].assertions[0].rank = 0)],
    ["unknown toolkit pin", (f) => (f.plan.provenance.revision = "main")],
])
    test(`AP/QED rejects ${name}`, () => {
        const f = qedFixture();
        mutate(f);
        assert.throws(() => prepareQed(f.articles, f.local, f.global, f.plan));
    });

test("QED human review binds every assertion to frozen source text and independent reviewer", () => {
    const f = qedFixture();
    const prepared = prepareQed(f.articles, f.local, f.global, f.plan);
    const reviews = prepared.evaluatorOnly.questions.map((q) => ({
        question_id: q.original.question_id,
        status: "approved-independent-human-review",
        rowHash: q.rowHash,
        manifestHash: prepared.manifest.sha256,
        author: "unit-author-only",
        reviewer: "unit-reviewer-only",
        reviewedAt: "2026-10-20",
        assertions: q.original.assertions.map((a) => ({
            rank: a.rank,
            approved: true,
            witnesses: [
                {
                    sourceId: "unit-article-1",
                    sourceHash: identity(f.articles[0]),
                    quote: "A synthetic source for adapter tests.",
                },
            ],
        })),
    }));
    assert.equal(
        validateQedReviews(prepared, reviews, f.articles).reviewedQuestions,
        40,
    );
    assert.throws(
        () => validateQedReviews(prepared, reviews.slice(1), f.articles),
        /Missing\/unknown/,
    );
    reviews[0].assertions[0].witnesses[0].quote = "invented";
    assert.throws(
        () => validateQedReviews(prepared, reviews, f.articles),
        /absent/,
    );
    reviews[0].assertions[0].witnesses[0].quote =
        "A synthetic source for adapter tests.";
    reviews[0].reviewer = reviews[0].author;
    assert.throws(
        () => validateQedReviews(prepared, reviews, f.articles),
        /independent/,
    );
    reviews[0].reviewer = "unit-reviewer-only";
    f.articles[0].version = 3;
    assert.throws(
        () => validateQedReviews(prepared, reviews, f.articles),
        /identity mismatch/,
    );
});

test("offline CLI prepares isolated packets, exports official JSONL and refuses overwritten/tampered data", async () => {
    const root = path.join(
        path.relative(
            process.cwd(),
            fileURLToPath(new URL("./quality-fixtures/", import.meta.url)),
        ),
        `cli-test-${process.pid}`,
    );
    await mkdir(root);
    const save = async (name, value) => {
        const filename = path.join(root, name);
        await writeFile(filename, JSON.stringify(value), { flag: "wx" });
        return filename;
    };
    try {
        const f = lmeFixture();
        const input = await save("lme-unit-only.json", f.rows);
        f.plan.provenance.sha256 = sha256(await readFile(input));
        const plan = await save("lme-plan.json", f.plan);
        const preparedDir = path.join(root, "prepared");
        const result = await main([
            "prepare-longmemeval",
            "--input",
            input,
            "--plan",
            plan,
            "--output",
            preparedDir,
        ]);
        assert.equal(result.execution, "not run");
        const construction = JSON.parse(
            await readFile(path.join(preparedDir, "construction.json"), "utf8"),
        );
        assert.equal(construction.length, 50);
        assert.ok(
            !JSON.stringify(construction).includes(
                "EVALUATOR_REFERENCE_SENTINEL",
            ),
        );
        const manifest = JSON.parse(
            await readFile(path.join(preparedDir, "manifest.json"), "utf8"),
        );
        const attempts = await save(
            "attempts.json",
            manifest.originalRowHashes.map((r) => ({
                question_id: r.id,
                status: "ok",
                hypothesis: "UNIT ONLY, NOT A BENCHMARK RESULT",
            })),
        );
        const hypotheses = path.join(root, "hypotheses.jsonl");
        await main([
            "export-lme-hypotheses",
            "--input",
            preparedDir,
            "--outputs",
            attempts,
            "--output",
            hypotheses,
        ]);
        assert.equal(
            (await readFile(hypotheses, "utf8")).trim().split("\n").length,
            50,
        );
        await assert.rejects(
            main([
                "export-lme-hypotheses",
                "--input",
                preparedDir,
                "--outputs",
                attempts,
                "--output",
                hypotheses,
            ]),
            /EEXIST/,
        );
        const labels = path.join(root, "labels.jsonl");
        await writeFile(
            labels,
            JSON.stringify({
                question_id: manifest.originalRowHashes[0].id,
                autoeval_label: { model: "unit-only", label: true },
            }) + "\n",
            { flag: "wx" },
        );
        const scores = path.join(root, "scores.json");
        await main([
            "summarize-lme-labels",
            "--input",
            preparedDir,
            "--labels",
            labels,
            "--output",
            scores,
        ]);
        assert.equal(
            JSON.parse(await readFile(scores, "utf8")).total.missing,
            49,
        );
        const goldFile = path.join(preparedDir, "evaluator-only.json");
        const gold = JSON.parse(await readFile(goldFile, "utf8"));
        gold.references[0].answer = "TAMPERED UNIT DATA";
        await writeFile(goldFile, JSON.stringify(gold));
        await assert.rejects(
            main([
                "export-lme-hypotheses",
                "--input",
                preparedDir,
                "--outputs",
                attempts,
                "--output",
                path.join(root, "bad.jsonl"),
            ]),
            /identity mismatch/,
        );

        const q = qedFixture();
        const articleDir = path.join(root, "articles");
        await mkdir(articleDir);
        const raw = "\uFEFF" + JSON.stringify(q.articles[0]);
        await writeFile(path.join(articleDir, "unit-article.json"), raw, {
            flag: "wx",
        });
        q.plan.corpusInventoryHash = identity([
            { path: "unit-article.json", sha256: sha256(raw) },
        ]);
        const local = await save("local.json", q.local);
        const global = await save("global.json", q.global);
        q.plan.localSha256 = sha256(await readFile(local));
        q.plan.globalSha256 = sha256(await readFile(global));
        q.plan.provenance.sha256 = identity({
            corpusInventoryHash: q.plan.corpusInventoryHash,
            localSha256: q.plan.localSha256,
            globalSha256: q.plan.globalSha256,
        });
        const qedPlan = await save("qed-plan.json", q.plan);
        const inventoryFile = path.join(root, "qed-inventory.json");
        await main([
            "inventory-qed",
            "--articles",
            articleDir,
            "--local",
            local,
            "--global",
            global,
            "--output",
            inventoryFile,
        ]);
        assert.equal(
            JSON.parse(await readFile(inventoryFile, "utf8")).combinedSha256,
            q.plan.provenance.sha256,
        );
        const qedDir = path.join(root, "qed-prepared");
        const qedResult = await main([
            "prepare-qed",
            "--articles",
            articleDir,
            "--local",
            local,
            "--global",
            global,
            "--plan",
            qedPlan,
            "--output",
            qedDir,
        ]);
        assert.equal(
            qedResult.gold,
            "pending-source-backed-independent-human-review",
        );
        const qedConstruction = await readFile(
            path.join(qedDir, "construction.json"),
            "utf8",
        );
        assert.ok(!qedConstruction.includes("EVALUATOR_"));
        assert.ok(qedConstruction.includes("body_nitf"));
    } finally {
        await rm(root, { recursive: true });
    }
});
