// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
    createMemoryBenchCommand,
    validateDatasetOptions,
} from "../src/memoryBench/cli.js";
import { prepareLongMemEval } from "../src/memoryBench/longmemeval/adapter.js";
import { publicPins } from "../src/memoryBench/longmemeval/pins.js";
import { digest } from "../src/memoryBench/longmemeval/protocol.js";
import { sessionSource } from "../src/memoryBench/longmemeval/runner.mjs";
import {
    assertPackageState,
    persistBenchmarkProgress,
} from "../src/memoryBench/longmemeval/state.mjs";
import { loadPrepared } from "../src/memoryBench/longmemeval/spec.mjs";
import type {
    OfficialQuestion,
    PreparationPlan,
} from "../src/memoryBench/longmemeval/types.js";

const plan: PreparationPlan = {
    scope: "full500",
    historyPolicy: "official-supplied",
    seed: "synthetic-parity",
    provenance: {
        ...publicPins.longMemEval,
        path: "longmemeval_s_cleaned.json",
        sha256: "a".repeat(64),
    },
};
const rows = (): OfficialQuestion[] =>
    Array.from({ length: 500 }, (_, index) => ({
        question_id: `q${index}`,
        question_type: "single-session-user",
        question: "READER_ONLY_QUESTION",
        answer: "EVALUATOR_ONLY_ANSWER",
        question_date: "2024/01/02 (Tue) 00:00",
        haystack_session_ids: ["repeated", "repeated"],
        haystack_dates: ["2024/01/01 (Mon) 00:00", "2024/01/03 (Wed) 00:00"],
        haystack_sessions: [
            [{ role: "user", content: "", has_answer: true }],
            [{ role: "assistant", content: "original retained turn" }],
        ],
        answer_session_ids: ["repeated"],
    }));

describe("multi-dataset memory CLI", () => {
    const lme = {
        dataset: "longmemeval" as const,
        output: "out",
        input: "longmemeval_s_cleaned.json",
        judgeSource: "evaluate_qa.py",
        authorizedLiveBenchmark: true,
    };
    test("LongMemEval does not inherit BEAM split, stage, RAG or protocol defaults", () => {
        expect(() => validateDatasetOptions(lme)).not.toThrow();
        for (const extra of [
            { split: "100k" as const },
            { stage: "smoke" as const },
            { mode: "rag" as const },
            { provider: "events" as const },
            { cache: "cache" },
            { unit: "unit" },
        ])
            expect(() =>
                validateDatasetOptions({ ...lme, ...extra }),
            ).toThrow();
    });
    test("authorization, pinned input and exactly one judge source are explicit", () => {
        expect(() =>
            validateDatasetOptions({ ...lme, authorizedLiveBenchmark: false }),
        ).toThrow(/authorization|authorized/);
        const { input: _input, ...withoutInput } = lme;
        expect(() => validateDatasetOptions(withoutInput)).toThrow(/input/);
        expect(() =>
            validateDatasetOptions({ ...lme, protocol: "other.py" }),
        ).toThrow(/not both/);
    });
    test("BEAM retains its options and rejects LongMemEval-only controls", () => {
        const beam = {
            dataset: "beam" as const,
            output: "out",
            progress: "progress",
            protocol: "protocol",
        };
        expect(() => validateDatasetOptions(beam)).not.toThrow();
        for (const extra of [
            { variant: "oracle" as const },
            { maxQuestions: "1" },
            { resume: "old" },
            { authorizedLiveBenchmark: true },
        ])
            expect(() => validateDatasetOptions({ ...beam, ...extra })).toThrow(
                /not supported/,
            );
    });
    test("actual Commander dispatch rejects incompatible options before inference", async () => {
        await expect(
            createMemoryBenchCommand()
                .exitOverride()
                .parseAsync([
                    "node",
                    "memory-bench",
                    "run",
                    "--dataset",
                    "longmemeval",
                    "--output",
                    "out",
                    "--split",
                    "100k",
                ]),
        ).rejects.toThrow(/split/);
        expect(createMemoryBenchCommand().description()).toContain(
            "LongMemEval",
        );
    });
});

describe("LongMemEval package fidelity", () => {
    test("construction preserves repeated positions, empty turns and original dates without gold", () => {
        const prepared = prepareLongMemEval(rows(), plan);
        const construction = prepared.construction[0];
        const sources = construction.sessions.map((session) =>
            sessionSource(construction.id, session),
        );
        expect(sources[0].canonicalUri).not.toBe(sources[1].canonicalUri);
        expect(construction.sessions[0].turns[0].content).toBe("");
        expect(construction.sessions[1].date).toBe("2024/01/03 (Wed) 00:00");
        const serialized = JSON.stringify(sources);
        for (const secret of [
            "READER_ONLY_QUESTION",
            "EVALUATOR_ONLY_ANSWER",
            "has_answer",
        ])
            expect(serialized).not.toContain(secret);
        expect(sources[1].source.temporalContext.scopes[1]).toMatchObject({
            role: "assistant",
        });
        expect(prepared.manifest.timestampConflicts).toHaveLength(500);
        expect(prepareLongMemEval(rows(), plan)).toEqual(prepared);
    });
    test("session temporal offsets describe retained text exactly", () => {
        const session = {
            id: "s",
            position: 0,
            date: "2024/01/01 (Mon) 00:00",
            turns: [{ role: "user", content: "Original" }],
        };
        const result = sessionSource("q", session);
        const scope = result.source.temporalContext.scopes[1];
        expect(result.sha256).toBe(digest(result.source.text));
        expect(result.source.text.slice(scope.start, scope.end)).toBe(
            "\n\n## Turn 1: user\nOriginal",
        );
    });
    test("historical schema is read-only, not resumable by the package engine", () => {
        expect(() =>
            assertPackageState({ engineHash: "old", cases: {} }),
        ).toThrow(/fresh arm/);
        expect(() =>
            assertPackageState({
                schemaVersion: "typeagent-memory-longmemeval-v1",
            }),
        ).not.toThrow();
    });
    test("raw dataset pins and variant are checked before execution", async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), "memory-lme-pin-"));
        try {
            const input = path.join(root, "data.json");
            await writeFile(input, "[]");
            await expect(
                loadPrepared({ variant: "oracle", datasetPath: input }),
            ).rejects.toThrow(/bytes changed/);
            await expect(
                loadPrepared({ variant: "unknown", datasetPath: input }),
            ).rejects.toThrow(/variant/);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    test("per-run and shared progress preserve graded-only accuracy and target coverage", async () => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "memory-lme-progress-"),
        );
        try {
            const progressPath = path.join(root, "registry.json");
            await persistBenchmarkProgress(
                root,
                [{ id: "q", sessions: [] }],
                {
                    runId: "synthetic",
                    progressPath,
                    outcome: "DIAGNOSTIC_SELECTION_COMPLETED",
                    cases: {
                        q: {
                            status: "complete",
                            autoeval_label: { label: true },
                        },
                    },
                },
                { questionIds: ["q"], supportedClose: "COMPLETE" },
            );
            const own = JSON.parse(
                await readFile(path.join(root, "progress.json"), "utf8"),
            );
            const registry = JSON.parse(await readFile(progressPath, "utf8"));
            expect(own.gradedQuestions).toBe(1);
            expect(own.passPercentage).toBe(100);
            expect(registry.activeRun).toBe("longmemeval:synthetic");
            expect(registry.accuracyDenominator).toBe("gradedQuestions");
            expect(registry.coverage).toBe(1);
            expect(registry.supportedClose).toBe("COMPLETE");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
