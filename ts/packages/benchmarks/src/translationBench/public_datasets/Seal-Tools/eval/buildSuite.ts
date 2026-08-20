// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Build a runner-ready TranslationBenchSuite directly from the parsed
// Seal-Tools eval rows. Each row keeps its own candidate tools, so it becomes
// its own single-schema case (activeSchemas = [that schema]); this preserves
// Seal-Tools' per-query tool set instead of exposing the whole catalog.

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
    applySealToolsTypeAgentOverride,
    DATASET_NAME,
    type TypeAgentEvalRow,
} from "../toTypeAgentSchema.js";

// Schema names double as dispatcher app-agent names; keep them identifier-safe.
function schemaNameFor(rowId: string): string {
    return rowId.replace(/[^A-Za-z0-9_]/g, "_");
}

function toLineage(row: TypeAgentEvalRow): TranslationBenchLineage {
    return {
        ...row.lineage,
        sourceHash: row.lineage.canonicalPayloadHash,
    };
}

export function buildSealToolsSuite(rows: TypeAgentEvalRow[]): {
    suite: TranslationBenchSuite;
    sourceManifest: TranslationBenchSuiteSourceIndex;
} {
    const schemas: TranslationBenchSchema[] = [];
    const cases: TranslationBenchCase[] = [];
    const sources: TranslationBenchLineage[] = [];

    for (const sourceRow of rows) {
        const row = applySealToolsTypeAgentOverride(sourceRow);
        const schemaName = schemaNameFor(row.id);
        schemas.push({
            schemaName,
            description: `Seal-Tools candidate tools for ${row.id}`,
            tools: row.tools,
        });

        const rewrite = (
            a: TranslationBenchAction,
        ): TranslationBenchAction => ({
            schemaName,
            actionName: a.actionName,
            ...(a.parameters !== undefined ? { parameters: a.parameters } : {}),
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

    // Rewriting schemaName to a per-row schema changes the canonical payload,
    // so recompute each case's hash the way the runner validates it. The
    // lineage object is shared with the source manifest, so both update.
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
