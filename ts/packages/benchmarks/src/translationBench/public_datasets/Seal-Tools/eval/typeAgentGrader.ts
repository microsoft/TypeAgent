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
import { hasSealToolsApiCallReference } from "../toTypeAgentSchema.js";
import { getSealToolsTypeAgentOverride } from "../typeAgentOverrides.js";

export interface SealToolsTypeAgentFilter {
    sourceRows: number;
    excludedApiCallDependencies: number;
    excludedDataQualityRows: number;
    scoredRows: number;
}

export function rescoreSealToolsTypeAgentRows(
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
                `Missing Seal case '${row.caseId}' while rescoring`,
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

export function summarizeSealToolsTypeAgentRows(rows: TranslationBenchRow[]): {
    rows: TranslationBenchRow[];
    summary: TranslationBenchSummary;
    filter: SealToolsTypeAgentFilter;
} {
    const apiCallRows = rows.filter(hasSealToolsApiCallReference);
    const dataQualityRows = rows.filter(
        (row) =>
            getSealToolsTypeAgentOverride(row.caseId)?.excludeFromScoring ===
            true,
    );
    const scoredRows = rows.filter(
        (row) =>
            !hasSealToolsApiCallReference(row) &&
            getSealToolsTypeAgentOverride(row.caseId)?.excludeFromScoring !==
                true,
    );
    return {
        rows: scoredRows,
        summary: aggregateTranslationBenchRows(scoredRows),
        filter: {
            sourceRows: rows.length,
            excludedApiCallDependencies: apiCallRows.length,
            excludedDataQualityRows: dataQualityRows.length,
            scoredRows: scoredRows.length,
        },
    };
}
