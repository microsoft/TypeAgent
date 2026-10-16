// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

import { rebuildTranslationBenchRunResult } from "../../../runner/scale.js";
import type {
    TranslationBenchRow,
    TranslationBenchRunResult,
} from "../../../runner/runner.js";
import {
    createSealToolsParameterScore,
    type TypeAgentEvalRow,
} from "../toTypeAgentSchema.js";
import { buildSealToolsSuite } from "./buildSuite.js";
import { scoreSealToolsOfficial } from "./sealToolsGrader.js";
import {
    sealToolsResponseText,
    type SealToolsTrajectoryRecord,
} from "./trajectoryJournal.js";
import {
    rescoreSealToolsTypeAgentRows,
    summarizeSealToolsTypeAgentRows,
} from "./typeAgentGrader.js";

const packageRoot = process.cwd();
const sealDir = path.join(
    packageRoot,
    "src/translationBench/public_datasets/Seal-Tools",
);
const datasetPath = path.join(sealDir, "seal-tools-validation.jsonl");
const outDir = path.resolve(
    process.argv[2] ?? path.join(sealDir, "eval/results/full"),
);

function groupBy<T, K>(
    values: readonly T[],
    keyFor: (value: T) => K,
): Map<K, T[]> {
    const groups = new Map<K, T[]>();
    for (const value of values) {
        const key = keyFor(value);
        const group = groups.get(key) ?? [];
        group.push(value);
        groups.set(key, group);
    }
    return groups;
}

const sourceRows = fs
    .readFileSync(datasetPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as TypeAgentEvalRow)
    .map((row) => ({
        ...row,
        parameterScore: createSealToolsParameterScore(
            row.expectedActions,
            row.tools,
        ),
    }));
const { suite } = buildSealToolsSuite(sourceRows);
const goldByCaseId = new Map(
    sourceRows.map((row) => [row.id, row.sealToolsGoldActions]),
);
const trajectoryRecords = fs
    .readFileSync(path.join(outDir, "trajectories.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as SealToolsTrajectoryRecord);
const trajectoriesBySetup = groupBy(
    trajectoryRecords,
    (record) => record.setupid,
);
const summaryPath = path.join(outDir, "summary.json");
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
    dataset: string;
    byModel: Record<string, Record<string, unknown>>;
};

for (const [model, modelSummary] of Object.entries(summary.byModel)) {
    const slug = model.replace(/[^A-Za-z0-9_.-]/g, "_");
    const resultPath = path.join(outDir, `results-${slug}.json`);
    const prior = JSON.parse(
        fs.readFileSync(resultPath, "utf8"),
    ) as TranslationBenchRunResult & Record<string, unknown>;
    const rows = rescoreSealToolsTypeAgentRows(
        prior.rows as TranslationBenchRow[],
        suite,
    );
    const rebuilt = rebuildTranslationBenchRunResult(rows, {
        schemaHashes: prior.schemaHashes,
        settings: prior.settings,
    });
    const typeAgent = summarizeSealToolsTypeAgentRows(rows);
    const rawResponsesByCase = new Map(
        [
            ...groupBy(
                trajectoriesBySetup.get(slug) ?? [],
                (record) => record.rowid,
            ),
        ].map(([caseId, records]) => [
            caseId,
            records
                .sort((left, right) => left.callIndex - right.callIndex)
                .map((record) => sealToolsResponseText(record.response))
                .filter(
                    (response): response is string => response !== undefined,
                ),
        ]),
    );
    const sealToolsOfficial = scoreSealToolsOfficial(rows, goldByCaseId, {
        rawResponsesByCase,
    });
    const sealToolsCaseInsensitive = scoreSealToolsOfficial(
        rows,
        goldByCaseId,
        { ignoreStringCase: true, rawResponsesByCase },
    );
    fs.writeFileSync(
        resultPath,
        JSON.stringify(
            {
                ...prior,
                ...rebuilt,
                sealToolsOfficial,
                sealToolsCaseInsensitive,
                typeAgentSupplemental: typeAgent.summary,
                typeAgentFilter: typeAgent.filter,
            },
            null,
            2,
        ),
    );
    summary.byModel[model] = {
        ...modelSummary,
        sealToolsOfficial,
        sealToolsCaseInsensitive,
        typeAgentSupplemental: typeAgent.summary,
        typeAgentFilter: typeAgent.filter,
    };
    console.log(
        `${model}: ${typeAgent.summary.passedCases}/${typeAgent.summary.totalCases}`,
    );
}

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
