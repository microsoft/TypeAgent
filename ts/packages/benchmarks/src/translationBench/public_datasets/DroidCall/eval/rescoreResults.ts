// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TranslationBenchRunResult } from "../../../runner/runner.js";
import type {
    DroidCallGoldAction,
    DroidCallTool,
    DroidCallTypeAgentEvalRow,
} from "../toTypeAgentSchema.js";
import { restoreDroidCallOfficialActions } from "./droidCallGrader.js";
import {
    DroidCallContractGrader,
    type DroidCallOfficialRow,
} from "./officialDroidCallGrader.js";
import {
    droidCallResponseText,
    type DroidCallTrajectoryRecord,
} from "./trajectoryJournal.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "../../../../..");
const droidCallDir = path.join(
    packageRoot,
    "src/translationBench/public_datasets/DroidCall",
);
const outDir = path.resolve(process.argv[2] ?? path.join(scriptDir, "results"));

function readJsonl<T>(file: string): T[] {
    const text = fs.readFileSync(file, "utf8").trim();
    return text === ""
        ? []
        : text.split("\n").map((line) => JSON.parse(line) as T);
}

function groupResponses(
    records: readonly DroidCallTrajectoryRecord[],
    setupId: string,
): Map<string, string[]> {
    const byCase = new Map<string, DroidCallTrajectoryRecord[]>();
    for (const record of records) {
        if (record.setupid !== setupId) continue;
        const group = byCase.get(record.rowid) ?? [];
        group.push(record);
        byCase.set(record.rowid, group);
    }
    return new Map(
        [...byCase].map(([caseId, group]) => [
            caseId,
            group
                .sort((left, right) => left.callIndex - right.callIndex)
                .map((record) => droidCallResponseText(record.response))
                .filter((value): value is string => value !== undefined),
        ]),
    );
}

const sourceRows = readJsonl<DroidCallTypeAgentEvalRow>(
    path.join(droidCallDir, "droid-call-multi-action.jsonl"),
);
const goldByCase = new Map<string, readonly DroidCallGoldAction[]>(
    sourceRows.map((row) => [row.id, row.droidCallGoldActions]),
);
const apiCatalog = readJsonl<DroidCallTool>(
    path.join(droidCallDir, "raw", "annotated_api.jsonl"),
);
const trajectories = readJsonl<DroidCallTrajectoryRecord>(
    path.join(outDir, "trajectories.jsonl"),
);
const summaryPath = path.join(outDir, "summary.json");
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
    byModel: Record<string, Record<string, unknown>>;
};
const grader = new DroidCallContractGrader(
    path.join(droidCallDir, "eval", "officialDroidCallGrader.py"),
);

try {
    for (const [model, modelSummary] of Object.entries(summary.byModel)) {
        const slug = model.replace(/[^A-Za-z0-9_.-]/g, "_");
        const resultPath = path.join(outDir, `results-${slug}.json`);
        const result = JSON.parse(
            fs.readFileSync(resultPath, "utf8"),
        ) as TranslationBenchRunResult & Record<string, unknown>;
        const responses = groupResponses(trajectories, slug);
        const rows: DroidCallOfficialRow[] = result.rows.map((row) => {
            const restored = restoreDroidCallOfficialActions(
                row,
                responses.get(row.caseId),
            );
            return {
                response: (restored ?? []).map((action) => ({
                    name: action.actionName,
                    arguments:
                        typeof action.parameters === "object" &&
                        action.parameters !== null &&
                        !Array.isArray(action.parameters)
                            ? (action.parameters as Record<string, unknown>)
                            : {},
                })),
                answers: goldByCase.get(row.caseId) ?? [],
            };
        });
        const droidCallPaperDescribed = await grader.score(
            rows,
            apiCatalog,
            "paper-described",
        );
        const droidCallReleased = await grader.score(
            rows,
            apiCatalog,
            "released",
        );
        const droidCallAdjusted = await grader.score(
            rows,
            apiCatalog,
            "typeagent-adjusted",
        );
        const scores = {
            droidCallPaperDescribed,
            droidCallReleased,
            droidCallAdjusted,
        };
        const { droidCallOfficial: _oldScore, ...resultWithoutOldScore } =
            result;
        fs.writeFileSync(
            resultPath,
            JSON.stringify({ ...resultWithoutOldScore, ...scores }, null, 2),
        );
        const { droidCallOfficial: _oldSummary, ...summaryWithoutOldScore } =
            modelSummary;
        summary.byModel[model] = { ...summaryWithoutOldScore, ...scores };
        console.log(
            `${model}: released ${(100 * droidCallReleased.softAccuracy).toFixed(2)}%/${(100 * droidCallReleased.accuracy).toFixed(2)}%; adjusted ${(100 * droidCallAdjusted.softAccuracy).toFixed(2)}%/${(100 * droidCallAdjusted.accuracy).toFixed(2)}%`,
        );
    }
} finally {
    await grader.close();
}

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
