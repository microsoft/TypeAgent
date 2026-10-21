// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    check,
    text,
    hash,
    unique,
    identity,
    clone,
    ratio,
} from "./quality-contract.mjs";

export const publicPins = Object.freeze({
    longMemEval: {
        repository: "https://github.com/xiaowu0162/LongMemEval",
        revision: "9e0b455f4ef0e2ab8f2e582289761153549043fc",
    },
    benchmarkQed: {
        repository: "https://github.com/microsoft/benchmark-qed",
        revision: "103bd2258e219621e1c8a7e96df3a8c1f6ac6fdb",
    },
});
export const lmeCategories = [
    "single-session-user",
    "single-session-assistant",
    "single-session-preference",
    "temporal-reasoning",
    "knowledge-update",
    "multi-session",
    "abstention",
];

function provenance(value, pin) {
    check(
        value?.repository === pin.repository && value.revision === pin.revision,
        "Missing/mismatched pinned public provenance",
    );
    text(value.path, "provenance path");
    hash(value.sha256, "provenance.sha256");
}

function officialTime(value) {
    text(value, "official date");
    const normalized = value
        .replace(/\s*\([A-Za-z]{3}\)/, "")
        .replaceAll("/", "-")
        .replace(" ", "T");
    const date = Date.parse(
        /[Zz]$|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`,
    );
    check(Number.isFinite(date), "Invalid official timestamp");
    return date;
}

function ranked(rows, seed, idKey) {
    return [...rows].sort((a, b) =>
        identity([seed, a[idKey]]).localeCompare(identity([seed, b[idKey]])),
    );
}

export function prepareLongMemEval(rows, plan) {
    provenance(plan.provenance, publicPins.longMemEval);
    text(plan.seed, "selection seed");
    check(
        [
            "longmemeval_s.json",
            "longmemeval_m.json",
            "longmemeval_oracle.json",
        ].includes(plan.provenance.path.split(/[\\/]/).at(-1)),
        "Unknown official LongMemEval variant",
    );
    unique(rows, "question_id", "LongMemEval questions");
    check(
        Object.keys(plan.quotas).length === lmeCategories.length &&
            lmeCategories.every(
                (c) =>
                    Number.isSafeInteger(plan.quotas[c]) && plan.quotas[c] > 0,
            ) &&
            Object.values(plan.quotas).reduce((a, b) => a + b, 0) === 50,
        "Require 50 preregistered questions across all seven strata",
    );
    for (const row of rows) {
        check(
            lmeCategories.slice(0, -1).includes(row.question_type),
            "Unknown official question_type",
        );
        text(row.question, "question");
        check(
            typeof row.answer === "string" || typeof row.answer === "number",
            "Missing official answer",
        );
        const cutoff = officialTime(row.question_date);
        const ids = row.haystack_session_ids;
        check(
            Array.isArray(ids) &&
                ids.length > 0 &&
                new Set(ids).size === ids.length &&
                ids.every((id) => typeof id === "string" && id.length > 0),
            "Invalid/duplicate session IDs",
        );
        check(
            Array.isArray(row.haystack_dates) &&
                Array.isArray(row.haystack_sessions) &&
                row.haystack_dates.length === ids.length &&
                row.haystack_sessions.length === ids.length,
            "History/date/session length mismatch",
        );
        check(
            Array.isArray(row.answer_session_ids) &&
                new Set(row.answer_session_ids).size ===
                    row.answer_session_ids.length &&
                row.answer_session_ids.every((id) => ids.includes(id)),
            "Unknown/duplicate answer session",
        );
        row.haystack_sessions.forEach((turns, index) => {
            check(
                officialTime(row.haystack_dates[index]) <= cutoff,
                "Future-message leakage: history exceeds official question cutoff",
            );
            check(
                Array.isArray(turns) && turns.length > 0,
                "Empty/invalid official session",
            );
            for (const turn of turns) {
                check(
                    ["user", "assistant"].includes(turn.role),
                    "Unknown history role",
                );
                text(turn.content, "turn content");
                check(
                    turn.has_answer === undefined ||
                        typeof turn.has_answer === "boolean",
                    "Invalid evidence label",
                );
            }
        });
    }
    const category = (row) =>
        row.question_id.endsWith("_abs") ? "abstention" : row.question_type;
    const selected = lmeCategories.flatMap((name) => {
        const available = ranked(
            rows.filter((r) => category(r) === name),
            plan.seed,
            "question_id",
        );
        check(
            available.length >= plan.quotas[name],
            `Insufficient LongMemEval stratum: ${name}`,
        );
        return available.slice(0, plan.quotas[name]);
    });
    const manifest = {
        schemaVersion: 1,
        benchmark: "LongMemEval adapted 50-question diagnostic",
        provenance: clone(plan.provenance),
        seed: plan.seed,
        quotas: clone(plan.quotas),
        originalRowHashes: selected.map((r) => ({
            id: r.question_id,
            sha256: identity(r),
            category: category(r),
        })),
        constructionPolicy:
            "Original session order, dates, roles and text; no answer labels, questions or references in construction",
        datePolicy:
            "Compare timezone-free official dates as UTC for cutoff validation; retain original timestamp strings",
    };
    return {
        manifest: { ...manifest, sha256: identity(manifest) },
        construction: selected.map((r) => ({
            id: r.question_id,
            cutoff: r.question_date,
            sessions: r.haystack_session_ids.map((id, index) => ({
                id,
                date: r.haystack_dates[index],
                turns: r.haystack_sessions[index].map((t) => ({
                    role: t.role,
                    content: t.content,
                })),
            })),
        })),
        readerOnly: {
            evaluatorOnly: true,
            questions: selected.map((r) => ({
                question_id: r.question_id,
                question: r.question,
                question_date: r.question_date,
            })),
        },
        evaluatorOnly: {
            evaluatorOnly: true,
            reviewStatus: "official-reference-preserved",
            references: clone(selected),
        },
    };
}

export function exportLongMemEvalHypotheses(prepared, outputs) {
    const expected = new Set(
        prepared.manifest.originalRowHashes.map((r) => r.id),
    );
    const byId = unique(outputs, "question_id", "hypotheses");
    check(
        byId.size === expected.size,
        "Absent outputs: official export requires every scheduled hypothesis",
    );
    for (const [id, row] of byId) {
        check(expected.has(id), "Unknown hypothesis");
        check(
            row.status === "ok",
            "Failed/missing output: do not fabricate an official hypothesis",
        );
        text(row.hypothesis, "hypothesis");
    }
    return (
        prepared.manifest.originalRowHashes
            .map(({ id }) =>
                JSON.stringify({
                    question_id: id,
                    hypothesis: byId.get(id).hypothesis,
                }),
            )
            .join("\n") + "\n"
    );
}

export function summarizeLongMemEvalLabels(prepared, labels) {
    const expected = prepared.manifest.originalRowHashes;
    const known = new Set(expected.map((r) => r.id));
    const rows = unique(labels, "question_id", "official labels");
    for (const [id, row] of rows) {
        check(known.has(id), "Unknown official label");
        check(
            typeof row.autoeval_label?.label === "boolean",
            "Official autoeval_label.label must be boolean",
        );
        text(row.autoeval_label.model, "Official evaluator model");
    }
    const summarize = (items) => ({
        correct: ratio(
            items.filter((r) => rows.get(r.id)?.autoeval_label.label === true)
                .length,
            items.length,
        ),
        scored: items.filter((r) => rows.has(r.id)).length,
        missing: items.filter((r) => !rows.has(r.id)).length,
    });
    return {
        scope: "Adapted diagnostic, not official full-suite performance; absent scores count in scheduled denominator",
        total: summarize(expected),
        categories: Object.fromEntries(
            lmeCategories.map((c) => [
                c,
                summarize(expected.filter((r) => r.category === c)),
            ]),
        ),
    };
}

export function prepareQed(articles, local, global, plan) {
    provenance(plan.provenance, publicPins.benchmarkQed);
    text(plan.seed, "selection seed");
    hash(
        plan.topicViewsHash,
        "Frozen topic-bound views hash required before heldout questions",
    );
    hash(plan.corpusInventoryHash, "corpus inventory hash");
    hash(plan.localSha256, "local assertion export hash");
    hash(plan.globalSha256, "global assertion export hash");
    check(
        plan.provenance.sha256 ===
            identity({
                corpusInventoryHash: plan.corpusInventoryHash,
                localSha256: plan.localSha256,
                globalSha256: plan.globalSha256,
            }),
        "QED combined provenance hash mismatch",
    );
    check(
        plan.termsAccepted === true,
        "AP-news dataset terms must be accepted by the operator",
    );
    const expectedCount =
        plan.inputScope === "adapter-test-fixture"
            ? plan.expectedArticles
            : 1397;
    check(
        Number.isSafeInteger(expectedCount) &&
            expectedCount > 0 &&
            articles.length === expectedCount,
        "Incomplete AP-news corpus; official corpus has 1,397 articles",
    );
    const documents = articles.map((raw) => {
        check(raw.type === "text", "Unsupported AP article type");
        text(raw.altids?.itemid, "AP itemid");
        text(raw.headline, "AP headline");
        text(raw.body_nitf, "AP body_nitf");
        check(
            Number.isSafeInteger(raw.version) && raw.version >= 0,
            "AP version required",
        );
        officialTime(raw.firstcreated);
        officialTime(raw.versioncreated);
        return {
            id: raw.altids.itemid,
            revision: String(raw.version),
            headline: raw.headline,
            firstcreated: raw.firstcreated,
            versioncreated: raw.versioncreated,
            body_nitf: raw.body_nitf,
            sourceHash: identity(raw),
        };
    });
    unique(documents, "id", "AP documents");
    const questions = [];
    for (const [kind, rows] of [
        ["local", local],
        ["global", global],
    ]) {
        unique(rows, "question_id", `QED ${kind} assertions`);
        check(rows.length >= 20, `Need at least 20 ${kind} questions`);
        for (const row of rows) {
            text(row.question_text, "QED question_text");
            check(
                Array.isArray(row.assertions) && row.assertions.length > 0,
                "Missing QED assertions; AutoQ is not a gold-answer generator",
            );
            for (const assertion of row.assertions) {
                text(assertion.statement, "assertion statement");
                check(
                    Number.isFinite(assertion.score) &&
                        assertion.score >= 0 &&
                        assertion.score <= 10,
                    "Invalid QED importance score",
                );
                check(
                    Number.isSafeInteger(assertion.rank) && assertion.rank > 0,
                    "Invalid assertion rank",
                );
                check(
                    Number.isSafeInteger(assertion.source_count) &&
                        assertion.source_count >= 0,
                    "Invalid assertion source count",
                );
            }
            check(
                new Set(row.assertions.map((a) => a.rank)).size ===
                    row.assertions.length,
                "Duplicate assertion rank",
            );
        }
        questions.push(
            ...ranked(rows, plan.seed, "question_id")
                .slice(0, 20)
                .map((r, i) => ({
                    kind,
                    split: i < 10 ? "development" : "holdout",
                    original: clone(r),
                    rowHash: identity(r),
                })),
        );
    }
    unique(
        questions.map((q) => ({ id: q.original.question_id })),
        "id",
        "QED selected questions",
    );
    const manifest = {
        schemaVersion: 1,
        benchmark: "BenchmarkQED/AP-news preparation",
        inputScope: plan.inputScope ?? "official-corpus",
        provenance: clone(plan.provenance),
        corpusInventoryHash: plan.corpusInventoryHash,
        questionExportHashes: {
            local: plan.localSha256,
            global: plan.globalSha256,
        },
        topicViewsHash: plan.topicViewsHash,
        seed: plan.seed,
        corpusHash: identity(documents),
        articles: documents.length,
        documentHashes: documents.map((d) => ({
            id: d.id,
            sha256: d.sourceHash,
        })),
        goldReviewStatus: "pending-source-backed-independent-human-review",
        questions: questions.map((q) => ({
            id: q.original.question_id,
            kind: q.kind,
            split: q.split,
            sha256: q.rowHash,
        })),
    };
    return {
        manifest: { ...manifest, sha256: identity(manifest) },
        construction: { documents },
        evaluatorOnly: {
            evaluatorOnly: true,
            reviewStatus: "pending-source-backed-independent-human-review",
            questions,
            instruction:
                "Human-review assertions against original source text and preserve rank/source metadata. AutoQ assertions are not reviewed gold or reference answers.",
        },
    };
}

export function validateQedReviews(prepared, reviews, articles) {
    const docs = new Map(articles.map((d) => [d.altids.itemid, d]));
    check(
        docs.size === articles.length &&
            docs.size === prepared.manifest.articles,
        "QED reviewed corpus count mismatch",
    );
    for (const expected of prepared.manifest.documentHashes) {
        check(
            docs.has(expected.id) &&
                identity(docs.get(expected.id)) === expected.sha256,
            "QED reviewed corpus identity mismatch",
        );
    }
    const rows = unique(reviews, "question_id", "QED human reviews");
    check(
        rows.size === prepared.evaluatorOnly.questions.length,
        "Missing/unknown QED human reviews",
    );
    for (const question of prepared.evaluatorOnly.questions) {
        const review = rows.get(question.original.question_id);
        check(
            review?.status === "approved-independent-human-review" &&
                review.rowHash === question.rowHash &&
                review.manifestHash === prepared.manifest.sha256,
            "Unreviewed/mismatched QED gold",
        );
        text(review.author, "QED assertion author");
        text(review.reviewer, "QED independent reviewer");
        check(
            review.author !== review.reviewer,
            "QED reviewer must be independent",
        );
        text(review.reviewedAt, "QED reviewedAt");
        check(
            Array.isArray(review.assertions) &&
                review.assertions.length ===
                    question.original.assertions.length,
            "Incomplete assertion review",
        );
        const ranks = new Set();
        for (const assertion of review.assertions) {
            check(
                question.original.assertions.some(
                    (a) => a.rank === assertion.rank,
                ) && !ranks.has(assertion.rank),
                "Unknown/duplicate assertion review rank",
            );
            ranks.add(assertion.rank);
            check(
                assertion.approved === true,
                "Rejected assertion requires a new preregistered manifest",
            );
            check(
                Array.isArray(assertion.witnesses) &&
                    assertion.witnesses.length > 0,
                "Source-backed assertion review required",
            );
            for (const witness of assertion.witnesses) {
                const source = docs.get(witness.sourceId);
                check(
                    source && identity(source) === witness.sourceHash,
                    "QED source identity mismatch",
                );
                text(witness.quote, "QED witness");
                check(
                    source.body_nitf.includes(witness.quote),
                    "QED witness absent from original AP text",
                );
            }
        }
    }
    return {
        reviewedQuestions: rows.size,
        manifestHash: prepared.manifest.sha256,
    };
}
