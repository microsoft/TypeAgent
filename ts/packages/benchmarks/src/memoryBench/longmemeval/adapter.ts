// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    check,
    text,
    hash,
    unique,
    identity,
    ratio,
    officialTime,
    ranked,
} from "../shared/data.mjs";
import { publicPins } from "./pins.js";
import path from "node:path";
import assert from "node:assert/strict";
import type {
    OfficialQuestion,
    PreparationPlan,
    PreparedLongMemEval,
    Hypothesis,
    OfficialLabel,
} from "./types.js";
const clone = structuredClone;

export const lmeCategories = [
    "single-session-user",
    "single-session-assistant",
    "single-session-preference",
    "temporal-reasoning",
    "knowledge-update",
    "multi-session",
    "abstention",
];

function provenance(
    value: PreparationPlan["provenance"],
    pin: { repository: string; revision: string },
) {
    check(
        value?.repository === pin.repository && value.revision === pin.revision,
        "Missing/mismatched pinned public provenance",
    );
    text(value.path, "provenance path");
    hash(value.sha256, "provenance.sha256");
}

export function prepareLongMemEval(
    rows: OfficialQuestion[],
    plan: PreparationPlan,
): PreparedLongMemEval {
    provenance(plan.provenance, publicPins.longMemEval);
    text(plan.seed, "selection seed");
    const filename = path.win32.basename(plan.provenance.path);
    const cleaned = filename.endsWith("_cleaned.json");
    check(
        [
            "longmemeval_s.json",
            "longmemeval_m.json",
            "longmemeval_s_cleaned.json",
            "longmemeval_m_cleaned.json",
            "longmemeval_oracle.json",
        ].includes(filename),
        "Unknown official LongMemEval variant",
    );
    unique(rows, "question_id", "LongMemEval questions");
    const full = plan.scope === "full500";
    const quotas = plan.quotas ?? {};
    check(plan.scope === undefined || full, "Unknown LongMemEval scope");
    const suppliedHistory = plan.historyPolicy === "official-supplied";
    check(
        plan.historyPolicy === undefined || (suppliedHistory && full),
        "Official-supplied history policy requires explicit full-suite scope",
    );
    const timestampConflicts: PreparedLongMemEval["manifest"]["timestampConflicts"] =
        [];
    if (full)
        check(
            rows.length === 500,
            "Full LongMemEval requires all 500 questions",
        );
    else
        check(
            Object.keys(quotas).length === lmeCategories.length &&
                lmeCategories.every(
                    (c) => Number.isSafeInteger(quotas[c]) && quotas[c] > 0,
                ) &&
                Object.values(quotas).reduce((a, b) => a + b, 0) === 50,
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
                (cleaned || new Set(ids).size === ids.length) &&
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
            const sessionTime = officialTime(row.haystack_dates[index]);
            if (suppliedHistory && sessionTime > cutoff)
                timestampConflicts.push({
                    questionId: row.question_id,
                    sessionPosition: index,
                    millisecondsAfterQuestion: sessionTime - cutoff,
                });
            else
                check(
                    sessionTime <= cutoff,
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
                if (cleaned)
                    check(
                        typeof turn.content === "string",
                        "Official cleaned turn content must be a string",
                    );
                else text(turn.content, "turn content");
                check(
                    turn.has_answer === undefined ||
                        typeof turn.has_answer === "boolean",
                    "Invalid evidence label",
                );
            }
        });
    }
    const category = (row: OfficialQuestion) =>
        row.question_id.endsWith("_abs") ? "abstention" : row.question_type;
    const selected = full
        ? ranked(rows, plan.seed, "question_id")
        : lmeCategories.flatMap((name) => {
              const available = ranked(
                  rows.filter((r) => category(r) === name),
                  plan.seed,
                  "question_id",
              );
              check(
                  available.length >= quotas[name],
                  `Insufficient LongMemEval stratum: ${name}`,
              );
              return available.slice(0, quotas[name]);
          });
    const manifest = {
        schemaVersion: 1,
        benchmark: full
            ? "LongMemEval full 500-question suite"
            : "LongMemEval adapted 50-question diagnostic",
        provenance: clone(plan.provenance),
        seed: plan.seed,
        quotas: full
            ? Object.fromEntries(
                  lmeCategories.map((name) => [
                      name,
                      selected.filter((row) => category(row) === name).length,
                  ]),
              )
            : clone(quotas),
        originalRowHashes: selected.map((r) => ({
            id: r.question_id,
            sha256: identity(r),
            category: category(r),
        })),
        constructionPolicy:
            "Original session order, dates, roles and text; no answer labels, questions or references in construction",
        datePolicy: suppliedHistory
            ? "Preserve every officially supplied history session; audit timestamps after the question instead of filtering; retain original strings"
            : "Compare timezone-free official dates as UTC for cutoff validation; retain original timestamp strings",
        timestampConflicts: timestampConflicts.sort(
            (a, b) =>
                a.questionId.localeCompare(b.questionId) ||
                a.sessionPosition - b.sessionPosition,
        ),
        sessionIdentityPolicy:
            "Retain official IDs and original positions; cleaned exports may repeat an ID, so never deduplicate histories",
    };
    return {
        manifest: { ...manifest, sha256: identity(manifest) },
        construction: selected.map((r) => ({
            id: r.question_id,
            cutoff: r.question_date,
            sessions: r.haystack_session_ids.map((id, index) => ({
                id,
                position: index,
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

export function exportLongMemEvalHypotheses(
    prepared: PreparedLongMemEval,
    outputs: Hypothesis[],
) {
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
            .map(({ id }) => {
                const output = byId.get(id);
                assert.ok(output, "Scheduled hypothesis is missing");
                return JSON.stringify({
                    question_id: id,
                    hypothesis: output.hypothesis,
                });
            })
            .join("\n") + "\n"
    );
}

export function summarizeLongMemEvalLabels(
    prepared: PreparedLongMemEval,
    labels: OfficialLabel[],
) {
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
    const summarize = (
        items: PreparedLongMemEval["manifest"]["originalRowHashes"],
    ) => ({
        correct: ratio(
            items.filter((r) => rows.get(r.id)?.autoeval_label.label === true)
                .length,
            items.length,
        ),
        scored: items.filter((r) => rows.has(r.id)).length,
        missing: items.filter((r) => !rows.has(r.id)).length,
    });
    return {
        scope:
            expected.length === 500
                ? "Full 500-question schedule; report dataset revision and actual judge model; absent scores count in scheduled denominator"
                : "Adapted diagnostic, not official full-suite performance; absent scores count in scheduled denominator",
        total: summarize(expected),
        categories: Object.fromEntries(
            lmeCategories.map((c) => [
                c,
                summarize(expected.filter((r) => r.category === c)),
            ]),
        ),
    };
}
