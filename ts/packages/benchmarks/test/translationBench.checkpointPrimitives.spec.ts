// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { afterAll, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    appendTranslationBenchCheckpointRows,
    createTranslationBenchRunFingerprint,
    readTranslationBenchCheckpoint,
    type TranslationBenchCheckpointHeader,
    type TranslationBenchCheckpointRow,
} from "../src/translationBench/synthesizer/generationSupport.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "translation-bench-"));
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
const header: TranslationBenchCheckpointHeader = {
    kind: "translation-bench-checkpoint",
    version: 1,
    runFingerprint: createTranslationBenchRunFingerprint({ run: 1 }),
    settings: { model: "test" },
    shardIndex: 0,
    shardCount: 1,
};
const row = (caseId: string): TranslationBenchCheckpointRow<string> => ({
    kind: "translation-bench-row",
    version: 1,
    phase: "generate",
    model: "test",
    scenario: "default",
    caseId,
    value: caseId,
});

describe("translation bench checkpoints", () => {
    it("recovers a torn final row before appending", () => {
        const checkpointPath = path.join(directory, "checkpoint.jsonl");
        appendTranslationBenchCheckpointRows(checkpointPath, header, [
            row("1"),
        ]);
        fs.appendFileSync(checkpointPath, '{"kind":"translation-bench-row"');
        appendTranslationBenchCheckpointRows(checkpointPath, header, [
            row("2"),
        ]);
        expect(
            readTranslationBenchCheckpoint<string>(checkpointPath).rows,
        ).toEqual([row("1"), row("2")]);
    });
});
