// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    computeTranslationBenchSourceHash,
    type TranslationBenchAction,
    type TranslationBenchCase,
    type TranslationBenchLineage,
    type TranslationBenchSchema,
    type TranslationBenchSuite,
    type TranslationBenchSuiteSourceIndex,
} from "../../../runner/runner.js";
import {
    DATASET_NAME,
    type DroidCallTypeAgentEvalRow,
} from "../toTypeAgentSchema.js";

function schemaNameFor(rowId: string): string {
    return rowId.replace(/[^A-Za-z0-9_]/g, "_");
}

function toLineage(row: DroidCallTypeAgentEvalRow): TranslationBenchLineage {
    return {
        ...row.lineage,
        sourceHash: row.lineage.canonicalPayloadHash,
    };
}

export function buildDroidCallSuite(rows: DroidCallTypeAgentEvalRow[]): {
    suite: TranslationBenchSuite;
    sourceManifest: TranslationBenchSuiteSourceIndex;
} {
    const schemas: TranslationBenchSchema[] = [];
    const cases: TranslationBenchCase[] = [];
    const sources: TranslationBenchLineage[] = [];

    for (const row of rows) {
        const schemaName = schemaNameFor(row.id);
        schemas.push({
            schemaName,
            description: `DroidCall candidate tools for ${row.id}`,
            tools: row.tools,
        });

        const rewrite = (
            action: TranslationBenchAction,
        ): TranslationBenchAction => ({
            schemaName,
            actionName: action.actionName,
            ...(action.parameters !== undefined
                ? { parameters: action.parameters }
                : {}),
        });
        const lineage = toLineage(row);
        cases.push({
            id: row.id,
            lineage,
            activeSchemas: [schemaName],
            seed: {
                utterance: row.utterance,
                expectedActions: row.expectedActions.map(rewrite),
                order: row.order,
                parameterScore: row.parameterScore,
            },
            dimensions: row.dimensions,
        });
        sources.push(lineage);
    }

    const suite: TranslationBenchSuite = {
        version: 1,
        name: DATASET_NAME,
        schemas,
        cases,
    };
    for (const evalCase of cases) {
        const hash = computeTranslationBenchSourceHash(suite, evalCase);
        evalCase.lineage.sourceHash = hash;
        evalCase.lineage.canonicalPayloadHash = hash;
    }

    return {
        suite,
        sourceManifest: { version: 1, sources },
    };
}
