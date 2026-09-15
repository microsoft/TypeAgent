// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    aggregateTranslationBenchRows,
    diagnoseTranslationBench,
    scoreTranslationBench,
    type TranslationBenchRow,
    type TranslationBenchSummary,
    type TranslationBenchSuite,
} from "../../../runner/runner.js";
import { hasDroidCallResultReference } from "../droidCallParser.js";

export interface DroidCallTypeAgentFilter {
    sourceRows: number;
    excludedResultDependencies: number;
    scoredRows: number;
}

export function rescoreDroidCallTypeAgentRows(
    rows: TranslationBenchRow[],
    suite: TranslationBenchSuite,
): TranslationBenchRow[] {
    const cases = new Map(
        suite.cases.map((evalCase) => [evalCase.id, evalCase]),
    );
    return rows.map((row) => {
        const evalCase = cases.get(row.caseId);
        if (evalCase === undefined) {
            throw new Error(
                `Missing DroidCall case '${row.caseId}' while rescoring`,
            );
        }
        const parameterScore = evalCase.seed.parameterScore;
        const score = scoreTranslationBench(
            evalCase.seed.expectedActions,
            row.chosenActions,
            evalCase.seed.order,
            0,
            {
                ...(parameterScore !== undefined ? { parameterScore } : {}),
                schemaValid: row.error === undefined,
            },
        );
        if (row.error !== undefined) {
            score.passed = false;
            score.exactPassed = false;
            score.schemaValid = false;
            score.diagnostics = diagnoseTranslationBench(
                evalCase.seed.expectedActions,
                [],
                evalCase.seed.order,
                row.error,
                parameterScore,
            );
        }
        return {
            ...row,
            expectedActions: evalCase.seed.expectedActions,
            score,
        };
    });
}

export function summarizeDroidCallTypeAgentRows(rows: TranslationBenchRow[]): {
    rows: TranslationBenchRow[];
    summary: TranslationBenchSummary;
    filter: DroidCallTypeAgentFilter;
} {
    const dependencyRows = rows.filter((row) =>
        hasDroidCallResultReference(row.expectedActions),
    );
    const scoredRows = rows.filter(
        (row) => !hasDroidCallResultReference(row.expectedActions),
    );
    return {
        rows: scoredRows,
        summary: aggregateTranslationBenchRows(scoredRows),
        filter: {
            sourceRows: rows.length,
            excludedResultDependencies: dependencyRows.length,
            scoredRows: scoredRows.length,
        },
    };
}
