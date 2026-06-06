// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Grade, GradedQuestion } from "./gradingSchema.js";

export type SystemGrade = {
    // The name of the system that produced these graded answers.
    system: string;
    graded: GradedQuestion[];
};

type Tally = {
    correct: number;
    partial: number;
    incorrect: number;
    total: number;
};

function emptyTally(): Tally {
    return { correct: 0, partial: 0, incorrect: 0, total: 0 };
}

function add(tally: Tally, grade: Grade): void {
    tally.total++;
    if (grade === "correct") {
        tally.correct++;
    } else if (grade === "partial") {
        tally.partial++;
    } else {
        tally.incorrect++;
    }
}

function score(t: Tally): string {
    if (t.total === 0) {
        return "0%";
    }
    // Partial credit counts as half, matching common LLM-judge scoring.
    const pct = ((t.correct + t.partial * 0.5) / t.total) * 100;
    return `${pct.toFixed(0)}%`;
}

function pad(value: string | number, width: number): string {
    const s = String(value);
    return s.length >= width ? s : s + " ".repeat(width - s.length);
}

// Print an aggregate + per-category + per-difficulty breakdown for each system,
// mirroring the summary tables produced by the .NET benchmark.
export function printReport(results: SystemGrade[]): void {
    for (const { system, graded } of results) {
        const overall = emptyTally();
        const byCategory = new Map<string, Tally>();
        const byDifficulty = new Map<string, Tally>();

        for (const g of graded) {
            add(overall, g.isCorrect);
            if (!byCategory.has(g.category)) {
                byCategory.set(g.category, emptyTally());
            }
            add(byCategory.get(g.category)!, g.isCorrect);
            if (!byDifficulty.has(g.difficulty)) {
                byDifficulty.set(g.difficulty, emptyTally());
            }
            add(byDifficulty.get(g.difficulty)!, g.isCorrect);
        }

        console.log("");
        console.log(`=== ${system} ===`);
        console.log(
            `${pad("OVERALL", 14)}${pad("score", 8)}${pad("correct", 9)}${pad("partial", 9)}${pad("incorrect", 11)}${pad("total", 7)}`,
        );
        console.log(
            `${pad("", 14)}${pad(score(overall), 8)}${pad(overall.correct, 9)}${pad(overall.partial, 9)}${pad(overall.incorrect, 11)}${pad(overall.total, 7)}`,
        );

        console.log("");
        console.log("By difficulty:");
        for (const level of ["easy", "moderate", "hard"]) {
            const t = byDifficulty.get(level);
            if (!t) {
                continue;
            }
            console.log(
                `  ${pad(level, 12)}${pad(score(t), 8)}${pad(`${t.correct}/${t.total}`, 10)}`,
            );
        }

        console.log("");
        console.log("By category:");
        const categories = [...byCategory.keys()].sort();
        for (const cat of categories) {
            const t = byCategory.get(cat)!;
            console.log(
                `  ${pad(cat, 14)}${pad(score(t), 8)}${pad(`${t.correct}/${t.total}`, 10)}`,
            );
        }
    }

    // Head-to-head best-answer tally only makes sense with >1 system.
    if (results.length > 1) {
        console.log("");
        console.log(
            "(Run with multiple systems to see a head-to-head best-answer tally.)",
        );
    }
}
