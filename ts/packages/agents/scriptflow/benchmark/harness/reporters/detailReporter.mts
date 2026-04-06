// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ScenarioResult } from "../types.mjs";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export function writeDetailReport(
    results: ScenarioResult[],
    outputDir: string,
): void {
    mkdirSync(outputDir, { recursive: true });

    writeFileSync(
        join(outputDir, "details.json"),
        JSON.stringify(results, null, 2),
    );

    const failures = results.filter((r) => !r.passed);
    const failureReport = failures.map((r) => ({
        scenarioId: r.scenarioId,
        description: r.description,
        utterance: r.utterance,
        failedEvaluations: r.evaluations
            .filter((e) => !e.passed)
            .map((e) => ({
                component: e.component,
                expected: e.expected,
                actual: e.actual,
                message: e.message,
            })),
        trace: {
            grammarMatchResult: r.trace.grammarMatchResult,
            matchedAgent: r.trace.matchedAgent,
            matchedAction: r.trace.matchedAction,
            extractedParams: r.trace.extractedParams,
            fallbackTriggered: r.trace.fallbackTriggered,
            reasoningInvoked: r.trace.reasoningInvoked,
            executionResult: r.trace.executionResult,
        },
    }));

    writeFileSync(
        join(outputDir, "failures.json"),
        JSON.stringify(failureReport, null, 2),
    );

    // Print failures to console
    if (failures.length > 0) {
        console.log(`\n  Failed Scenarios (${failures.length}):`);
        for (const f of failures) {
            console.log(`\n    [${f.scenarioId}] ${f.description}`);
            console.log(`    Utterance: "${f.utterance}"`);
            for (const ev of f.evaluations.filter((e) => !e.passed)) {
                console.log(
                    `    FAIL [${ev.component}]: ${ev.message ?? `expected ${JSON.stringify(ev.expected)}, got ${JSON.stringify(ev.actual)}`}`,
                );
            }
        }
    }
}
