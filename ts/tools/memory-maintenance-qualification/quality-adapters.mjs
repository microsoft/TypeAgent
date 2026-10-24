// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export {
    lmeCategories,
    prepareLongMemEval,
    exportLongMemEvalHypotheses,
    summarizeLongMemEvalLabels,
} from "../../packages/benchmarks/dist/memoryBench/longmemeval/adapter.js";
import {
    officialTime,
    ranked,
} from "../../packages/benchmarks/src/memoryBench/shared/data.mjs";
import { publicPins as memoryPins } from "../../packages/benchmarks/dist/memoryBench/longmemeval/pins.js";

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
    longMemEval: memoryPins.longMemEval,
    benchmarkQed: {
        repository: "https://github.com/microsoft/benchmark-qed",
        revision: "103bd2258e219621e1c8a7e96df3a8c1f6ac6fdb",
    },
});

function provenance(value, pin) {
    check(
        value?.repository === pin.repository && value.revision === pin.revision,
        "Missing/mismatched pinned public provenance",
    );
    text(value.path, "provenance path");
    hash(value.sha256, "provenance.sha256");
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
