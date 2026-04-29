// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ScenarioResult,
    Scorecard,
    CategorySummary,
    ComponentAccuracy,
} from "../types.mjs";

export function buildScorecard(
    results: ScenarioResult[],
    startTime: number,
): Scorecard {
    const endTime = Date.now();

    const summary = buildSummary(results);
    const byCategory = buildByCategory(results);
    const byComponent = buildByComponent(results);

    return {
        timestamp: new Date().toISOString(),
        durationSeconds: Math.round((endTime - startTime) / 1000),
        summary,
        byCategory,
        byComponent,
        regressions: [],
        improvements: [],
    };
}

function buildSummary(results: ScenarioResult[]): CategorySummary {
    return {
        total: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: results.filter((r) => !r.passed).length,
        skipped: 0,
    };
}

function buildByCategory(
    results: ScenarioResult[],
): Record<string, CategorySummary> {
    const categories = new Map<string, ScenarioResult[]>();
    for (const r of results) {
        const list = categories.get(r.category) ?? [];
        list.push(r);
        categories.set(r.category, list);
    }

    const out: Record<string, CategorySummary> = {};
    for (const [cat, catResults] of categories) {
        out[cat] = buildSummary(catResults);
    }
    return out;
}

function buildByComponent(
    results: ScenarioResult[],
): Record<string, ComponentAccuracy> {
    const components = new Map<string, { total: number; correct: number }>();

    for (const r of results) {
        for (const ev of r.evaluations) {
            const existing = components.get(ev.component) ?? {
                total: 0,
                correct: 0,
            };
            existing.total++;
            if (ev.passed) existing.correct++;
            components.set(ev.component, existing);
        }
    }

    const out: Record<string, ComponentAccuracy> = {};
    for (const [comp, stats] of components) {
        out[comp] = {
            accuracy:
                stats.total > 0
                    ? Math.round((stats.correct / stats.total) * 1000) / 1000
                    : 0,
            total: stats.total,
            correct: stats.correct,
        };
    }
    return out;
}

export function printScorecard(scorecard: Scorecard): void {
    const s = scorecard.summary;
    const passRate = s.total > 0 ? ((s.passed / s.total) * 100).toFixed(1) : 0;

    console.log("\n========================================");
    console.log("  PowerShell Reliability Benchmark");
    console.log("========================================");
    console.log(
        `  Total: ${s.total} | Passed: ${s.passed} | Failed: ${s.failed} | Pass Rate: ${passRate}%`,
    );
    console.log(`  Duration: ${scorecard.durationSeconds}s`);

    console.log("\n  By Category:");
    for (const [cat, catSummary] of Object.entries(scorecard.byCategory)) {
        const rate =
            catSummary.total > 0
                ? ((catSummary.passed / catSummary.total) * 100).toFixed(1)
                : "0.0";
        console.log(
            `    ${cat.padEnd(20)} ${catSummary.passed}/${catSummary.total} (${rate}%)`,
        );
    }

    console.log("\n  By Component:");
    for (const [comp, acc] of Object.entries(scorecard.byComponent)) {
        console.log(
            `    ${comp.padEnd(20)} ${(acc.accuracy * 100).toFixed(1)}% (${acc.correct}/${acc.total})`,
        );
    }
    console.log("========================================\n");
}

export function compareScorecards(
    current: Scorecard,
    baseline: Scorecard,
): { regressions: string[]; improvements: string[] } {
    // For now, a simple comparison could be done at the category level
    const regressions: string[] = [];
    const improvements: string[] = [];

    for (const [cat, currentSummary] of Object.entries(current.byCategory)) {
        const baselineSummary = baseline.byCategory[cat];
        if (!baselineSummary) continue;

        const currentRate =
            currentSummary.total > 0
                ? currentSummary.passed / currentSummary.total
                : 0;
        const baselineRate =
            baselineSummary.total > 0
                ? baselineSummary.passed / baselineSummary.total
                : 0;

        if (currentRate < baselineRate) {
            regressions.push(
                `${cat}: ${(baselineRate * 100).toFixed(1)}% -> ${(currentRate * 100).toFixed(1)}%`,
            );
        } else if (currentRate > baselineRate) {
            improvements.push(
                `${cat}: ${(baselineRate * 100).toFixed(1)}% -> ${(currentRate * 100).toFixed(1)}%`,
            );
        }
    }

    return { regressions, improvements };
}
