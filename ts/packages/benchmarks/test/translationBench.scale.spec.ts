// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    appendTranslationBenchCheckpointRows,
    createTranslationBenchRunFingerprint,
    createTranslationBenchTranslationCheckpointRow,
    readTranslationBenchCheckpoint,
    splitTranslationBenchCheckpointLines,
    translationBenchResumeKey,
    type TranslationBenchCheckpointHeader,
} from "../src/translationBench/runner/scale.js";
import {
    getDefaultTranslationBenchScenario,
    getTranslationBenchShape,
    scoreTranslationBench,
    type TranslationBenchRow,
} from "../src/translationBench/runner/runner.js";

function sampleRow(caseId: string): TranslationBenchRow {
    const scenario = getDefaultTranslationBenchScenario();
    const expectedActions: TranslationBenchRow["expectedActions"] = [];
    const score = scoreTranslationBench(expectedActions, [], "any");
    return {
        caseId,
        scenarioId: scenario.id,
        scenario,
        lineage: {
            dataset: "test",
            revision: "r1",
            config: "c1",
            split: "train",
            rowIndex: 0,
            rowId: caseId,
            sourceUrl: "https://example.test",
            sourceHash: "a".repeat(64),
            transformVersion: 1,
        },
        model: "azure/gpt-4.1-mini",
        activeSchemas: ["browser"],
        activeSchemaCount: 1,
        activeActionCount: 1,
        utterance: `utterance-${caseId}`,
        order: "any",
        expectedActions,
        chosenActions: [],
        rawChosenActions: [],
        score,
        shape: getTranslationBenchShape({
            utterance: `utterance-${caseId}`,
            expectedActions,
            order: "any",
        }),
        elapsedMs: 1,
        usage: {
            calls: 1,
            promptTokens: 1,
            completionTokens: 1,
            cachedTokens: undefined,
            reasoningTokens: undefined,
            estimatedCostUsd: undefined,
        },
    };
}

describe("translationBench scale checkpoint", () => {
    it("fingerprints content identity (suite hash changes resume key)", () => {
        const a = createTranslationBenchRunFingerprint({
            models: ["m"],
            benchmarkHash: "a".repeat(64),
        });
        const b = createTranslationBenchRunFingerprint({
            models: ["m"],
            benchmarkHash: "b".repeat(64),
        });
        expect(a).not.toBe(b);
        expect(a).toHaveLength(64);
    });

    it("drops a truncated trailing line and resumes complete rows", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-scale-"));
        const filePath = path.join(dir, "ckpt.jsonl");
        try {
            const header: TranslationBenchCheckpointHeader = {
                kind: "translation-bench-checkpoint",
                version: 1,
                runFingerprint: createTranslationBenchRunFingerprint({
                    settings: { kind: "test" },
                }),
                settings: { kind: "test" },
                shardIndex: 0,
                shardCount: 1,
            };
            const row = sampleRow("case-1");
            const ckptRow = createTranslationBenchTranslationCheckpointRow(row);
            appendTranslationBenchCheckpointRows(filePath, header, [ckptRow]);

            // Simulate crash mid-append: partial second line without newline.
            fs.appendFileSync(
                filePath,
                '{"phase":"translation","model":"m"',
                "utf8",
            );
            const lines = splitTranslationBenchCheckpointLines(
                fs.readFileSync(filePath, "utf8"),
            );
            expect(lines.length).toBe(2); // header + complete row

            const loaded =
                readTranslationBenchCheckpoint<TranslationBenchRow>(filePath);
            expect(loaded.rows).toHaveLength(1);
            expect(loaded.rows[0]!.value.caseId).toBe("case-1");
            expect(translationBenchResumeKey(loaded.rows[0]!)).toContain(
                "case-1",
            );

            const second = createTranslationBenchTranslationCheckpointRow(
                sampleRow("case-2"),
            );
            appendTranslationBenchCheckpointRows(
                filePath,
                header,
                [second],
                loaded,
            );
            const resumed =
                readTranslationBenchCheckpoint<TranslationBenchRow>(filePath);
            expect(resumed.rows.map((item) => item.value.caseId)).toEqual([
                "case-1",
                "case-2",
            ]);
            expect(fs.readFileSync(filePath, "utf8")).not.toContain(
                '{"phase":"translation","model":"m"',
            );
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
