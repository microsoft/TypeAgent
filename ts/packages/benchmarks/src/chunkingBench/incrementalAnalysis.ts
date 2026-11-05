// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { readFile } from "node:fs/promises";
import {
    list,
    object,
    readJson,
    saveJson,
    text,
    bytesHash,
    digest,
} from "../memoryBench/storage.js";
import { PairReceipts } from "./incrementalReceipts.js";

export interface PairedRow {
    questionId: string;
    groupId: string;
    category: string;
    arm: string;
    correct?: boolean;
    state: string;
    verdict?: string;
    seconds?: number;
    contextChars?: number;
    refinements?: number;
    lexicalMs?: number;
    gateActivations?: number;
    nativeAnswerOperations?: number;
}

function transitions(rows: PairedRow[], ids: string[], arm: string) {
    let rescues = 0,
        regressions = 0,
        bothCorrect = 0,
        neitherCorrect = 0;
    const unmatched: string[] = [];
    for (const id of ids) {
        const baseline = rows.find(
            (row) => row.questionId === id && row.arm === "N0",
        );
        const variant = rows.find(
            (row) => row.questionId === id && row.arm === arm,
        );
        if (baseline?.correct === undefined || variant?.correct === undefined) {
            unmatched.push(id);
            continue;
        }
        if (baseline.correct && variant.correct) bothCorrect++;
        else if (baseline.correct) regressions++;
        else if (variant.correct) rescues++;
        else neitherCorrect++;
    }
    const jointlyScored = ids.length - unmatched.length;
    return {
        selected: ids.length,
        jointlyScored,
        jointCoverage: ids.length ? jointlyScored / ids.length : 0,
        rescues,
        regressions,
        bothCorrect,
        neitherCorrect,
        unmatched,
        netPairedLift: jointlyScored
            ? (rescues - regressions) / jointlyScored
            : null,
    };
}

export function pairedSummary(
    rows: PairedRow[],
    questions: { id: string; category: string; groupId: string }[],
    arms: string[],
) {
    const ids = questions.map((question) => question.id);
    return {
        interpretation:
            "Inspected exploratory regression pilot; no adoption or historical standalone-BM25 hybrid-gain claim",
        uncertainty:
            "Not estimated: small inspected cohort, clustered by groupId; not a held-out sample",
        groups: [...new Set(questions.map((q) => q.groupId))],
        arms: arms.map((arm) => {
            const selected = rows.filter((row) => row.arm === arm);
            const scored = selected.filter((row) => row.correct !== undefined);
            const correct = scored.filter((row) => row.correct).length;
            return {
                arm,
                selected: ids.length,
                attempted: selected.length,
                scored: scored.length,
                failed: selected.length - scored.length,
                pending: ids.length - selected.length,
                correct,
                coverage: scored.length / ids.length,
                correctOverSelected: correct / ids.length,
                scoredOnlyAccuracy: scored.length
                    ? correct / scored.length
                    : null,
                verdicts: Object.fromEntries(
                    [
                        ...new Set(
                            scored.map((row) => row.verdict ?? "official-beam"),
                        ),
                    ].map((verdict) => [
                        verdict,
                        scored.filter(
                            (row) =>
                                (row.verdict ?? "official-beam") === verdict,
                        ).length,
                    ]),
                ),
                answerLatencySeconds: quantiles(
                    scored.flatMap((row) =>
                        row.seconds === undefined ? [] : [row.seconds],
                    ),
                ),
                lexicalMilliseconds: quantiles(
                    scored.flatMap((row) =>
                        row.lexicalMs === undefined ? [] : [row.lexicalMs],
                    ),
                ),
                gateActivations: scored.reduce(
                    (sum, row) => sum + (row.gateActivations ?? 0),
                    0,
                ),
                refinements: scored.reduce(
                    (sum, row) => sum + (row.refinements ?? 0),
                    0,
                ),
            };
        }),
        paired: arms
            .filter((arm) => arm !== "N0")
            .map((arm) => ({
                arm,
                ...transitions(rows, ids, arm),
                categories: Object.fromEntries(
                    [...new Set(questions.map((q) => q.category))].map(
                        (category) => [
                            category,
                            transitions(
                                rows,
                                questions
                                    .filter((q) => q.category === category)
                                    .map((q) => q.id),
                                arm,
                            ),
                        ],
                    ),
                ),
            })),
    };
}

function quantiles(values: number[]) {
    const ordered = [...values].sort((a, b) => a - b);
    const percentile = (fraction: number) =>
        ordered.length
            ? ordered[Math.ceil(ordered.length * fraction) - 1]
            : null;
    return { p50: percentile(0.5), p95: percentile(0.95) };
}

/** Replays saved baseline diagnostics without issuing any provider requests. */
export async function replayNativeCoverage(directory: string) {
    const scorecard = object(
        await readJson(path.join(directory, "scorecard.json")),
    );
    const rows = list(scorecard.rows)
        .map(object)
        .map((row) => {
            const evidence =
                row.evidence === undefined ? undefined : object(row.evidence);
            if (!evidence)
                return {
                    questionId: row.questionId,
                    classification: "unscored",
                    state: row.state,
                };
            const final = object(object(evidence.finalSources).metrics);
            const all = object(object(evidence.allReaderSources).metrics);
            const grade = object(row.grade);
            const finalRecall = Number(final.recall);
            const allRecall = Number(all.recall);
            return {
                questionId: row.questionId,
                verdict: grade.verdict,
                finalRecall,
                allRecall,
                classification:
                    allRecall === 0
                        ? "no-annotated-reader-evidence"
                        : allRecall < 1
                          ? "partial-reader-evidence"
                          : grade.verdict === "correct"
                            ? "annotated-evidence-and-correct"
                            : "reader-or-rubric-diagnostic-needed",
                candidateAttribution:
                    "unobservable-in-legacy-receipt; cannot distinguish absent pool vs rank vs passage without new traces",
            };
        });
    return { mode: "offline-legacy-coverage-replay", rows };
}

export async function analyzeIncremental(output: string) {
    const preregistration = object(
        await readJson(path.join(output, "preregistration.json")),
    );
    const questions = list(preregistration.questions).map((value) => {
        const q = object(value);
        return {
            id: text(q.id),
            category: text(q.category),
            groupId: text(q.groupId),
        };
    });
    const arms = list(preregistration.arms).map(text);
    const rows: PairedRow[] = [];
    for (const arm of arms)
        for (const question of questions) {
            const receipts = new PairReceipts(
                path.join(output, "pairs", arm, bytesHash(question.id)),
                digest(preregistration),
            );
            const grade = await receipts.read("grade");
            if (grade) {
                rows.push(object(grade.row) as unknown as PairedRow);
                continue;
            }
            if (await receipts.read("answer-attempt"))
                rows.push({
                    questionId: question.id,
                    groupId: question.groupId,
                    category: question.category,
                    arm,
                    state: (await receipts.read("answer"))
                        ? "grade-pending-or-failed"
                        : "answer-failed-or-interrupted",
                });
        }
    const summary = {
        ...pairedSummary(rows, questions, arms),
        operations: await incrementalOperations(output, questions, arms),
    };
    await saveJson(path.join(output, "paired-analysis.json"), summary);
    return summary;
}

export async function incrementalOperations(
    output: string,
    questions: { id: string }[],
    arms: string[],
) {
    const counts = {
        nativeAnswerStarted: 0,
        nativeAnswerReturned: 0,
        nativeAnswerErrors: 0,
        judgeGenerateStarted: 0,
        judgeGenerateReturned: 0,
        judgeGenerateErrors: 0,
    };
    for (const arm of arms)
        for (const question of questions) {
            const file = path.join(
                output,
                "pairs",
                arm,
                bytesHash(question.id),
                "operations.jsonl",
            );
            let raw: string;
            try {
                raw = await readFile(file, "utf8");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT")
                    continue;
                throw error;
            }
            addOperations(raw, counts);
        }
    return {
        ...counts,
        nativeInternalModelCalls: null,
        nativeInternalTokens: null,
        accounting:
            "actual bridge operations including retries; native internal translation/reader/refinement calls not exposed, never assumed equal to one",
    };
}

function addOperations(
    raw: string,
    counts: {
        nativeAnswerStarted: number;
        nativeAnswerReturned: number;
        nativeAnswerErrors: number;
        judgeGenerateStarted: number;
        judgeGenerateReturned: number;
        judgeGenerateErrors: number;
    },
) {
    for (const line of raw.trim().split(/\r?\n/u).filter(Boolean)) {
        const event = object(JSON.parse(line));
        const phase =
            event.phase === "native-answer"
                ? "nativeAnswer"
                : event.phase === "judge-generate"
                  ? "judgeGenerate"
                  : undefined;
        const state =
            event.state === "started"
                ? "Started"
                : event.state === "returned"
                  ? "Returned"
                  : event.state === "error"
                    ? "Errors"
                    : undefined;
        if (phase && state) counts[`${phase}${state}`]++;
    }
}
