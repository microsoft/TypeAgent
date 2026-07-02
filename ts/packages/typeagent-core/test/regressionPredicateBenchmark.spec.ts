// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Measures the default "likely-bad change" predicate against a set of blind
// human labels over real replay deltas. The deltas are produced by running the
// actual grammar replay resolver over the committed player corpus for a set of
// hand-authored grammar variants (see the fixtures under
// `test/fixtures/regression-variants/`), so every row is a genuine action delta
// the matcher can reproduce — not a hand-written comparison. The committed
// `player.regression-benchmark.jsonl` carries each delta plus a human label
// judged only from the utterance and the two actions; the predicate never sees
// the label, and the label is not derived from the predicate.

import { readFileSync } from "node:fs";
import { likelyBadChange } from "../src/replay/predicate.js";
import { actionsEqual } from "../src/replay/engine.js";
import {
    BENCHMARK_PATH,
    generateAllDeltas,
    gitAvailable,
} from "./regressionBenchmarkHarness.js";

type Label = "regression" | "improvement" | "benign";

interface BenchmarkRow {
    rowId: string;
    variant: string;
    utterance: string;
    actionA: unknown;
    actionB: unknown;
    label: Label;
}

/** Threshold the predicate must clear against the blind labels. */
const AGREEMENT_THRESHOLD = 0.8;

/** Minimum share each outcome class must hold so agreement is not trivial. */
const MIN_CLASS_PREVALENCE = 0.25;

function loadBenchmark(): BenchmarkRow[] {
    return readFileSync(BENCHMARK_PATH, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as BenchmarkRow);
}

/** A label or predicate verdict is "red" only when it flags a regression. */
function isRed(value: Label | ReturnType<typeof likelyBadChange>): boolean {
    return value === "regression";
}

/** Run the predicate on a benchmark row (all rows are non-equal deltas). */
function predict(row: BenchmarkRow): ReturnType<typeof likelyBadChange> {
    return likelyBadChange({
        actionA: row.actionA ?? undefined,
        actionB: row.actionB ?? undefined,
        equal: false,
    });
}

const rows = loadBenchmark();

describe("regression predicate benchmark", () => {
    it("has a well-formed, labelled delta set", () => {
        expect(rows.length).toBeGreaterThanOrEqual(20);
        const ids = new Set<string>();
        for (const row of rows) {
            expect(typeof row.rowId).toBe("string");
            expect(row.rowId.length).toBeGreaterThan(0);
            expect(ids.has(row.rowId)).toBe(false);
            ids.add(row.rowId);
            expect(typeof row.utterance).toBe("string");
            expect(["regression", "improvement", "benign"]).toContain(
                row.label,
            );
            // Every row must be a real delta: at least one side resolved and the
            // two sides differ.
            expect(row.actionA !== null || row.actionB !== null).toBe(true);
            expect(actionsEqual(row.actionA, row.actionB)).toBe(false);
        }
    });

    it("keeps both outcome classes well represented", () => {
        const red = rows.filter((r) => isRed(r.label)).length;
        const green = rows.length - red;
        expect(red / rows.length).toBeGreaterThanOrEqual(MIN_CLASS_PREVALENCE);
        expect(green / rows.length).toBeGreaterThanOrEqual(
            MIN_CLASS_PREVALENCE,
        );
    });

    it("agrees with the blind labels on at least the threshold share", () => {
        const agree = rows.filter(
            (r) => isRed(predict(r)) === isRed(r.label),
        ).length;
        const agreement = agree / rows.length;
        // eslint-disable-next-line no-console
        console.log(
            `predicate agreement: ${agree}/${rows.length} = ${(agreement * 100).toFixed(1)}%`,
        );
        expect(agreement).toBeGreaterThanOrEqual(AGREEMENT_THRESHOLD);
    });

    it("covers regression, improvement, and benign verdict paths", () => {
        const verdicts = new Set(rows.map((r) => predict(r)));
        expect(verdicts.has("regression")).toBe(true);
        expect(verdicts.has("improvement")).toBe(true);
        expect(verdicts.has("benign")).toBe(true);
    });

    // A predicate that ignores its input and always returns one verdict must not
    // clear the threshold; otherwise a high score would say nothing about the
    // real predicate's discernment.
    it("is not beaten by an always-regression predicate", () => {
        const agree = rows.filter((r) => isRed(r.label) === true).length;
        expect(agree / rows.length).toBeLessThan(AGREEMENT_THRESHOLD);
    });

    it("is not beaten by an always-benign predicate", () => {
        const agree = rows.filter((r) => isRed(r.label) === false).length;
        expect(agree / rows.length).toBeLessThan(AGREEMENT_THRESHOLD);
    });
});

// The committed deltas are only trustworthy if the real resolver still produces
// exactly them from the fixtures. This regenerates every delta from HEAD vs. a
// throwaway variant commit and checks it matches the committed set byte-for-
// action. Skipped where git is unavailable (the measurement above still runs).
const maybe = gitAvailable() ? describe : describe.skip;

maybe("regression benchmark authenticity", () => {
    it("regenerates the committed deltas from the variant fixtures", async () => {
        const generated = await generateAllDeltas();
        const committed = new Map(rows.map((r) => [r.rowId, r]));
        expect(generated.length).toBe(rows.length);
        for (const g of generated) {
            const c = committed.get(g.rowId);
            expect(c).toBeDefined();
            expect(g.utterance).toBe(c!.utterance);
            expect(actionsEqual(g.actionA ?? null, c!.actionA)).toBe(true);
            expect(actionsEqual(g.actionB ?? null, c!.actionB)).toBe(true);
        }
    });

    it("is deterministic across repeated replays", async () => {
        const first = await generateAllDeltas();
        const second = await generateAllDeltas();
        expect(second.length).toBe(first.length);
        for (let i = 0; i < first.length; i++) {
            expect(second[i].rowId).toBe(first[i].rowId);
            expect(actionsEqual(second[i].actionA, first[i].actionA)).toBe(
                true,
            );
            expect(actionsEqual(second[i].actionB, first[i].actionB)).toBe(
                true,
            );
        }
    });
});
