// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TfIdfScorer,
    ScorerCandidate,
} from "../src/context/contextSelector/scorer.js";
import { ContextVector } from "../src/context/contextSelector/conversationSignal.js";

const scorer = new TfIdfScorer();

function cand(
    schemaName: string,
    actionName: string,
    keywords: string[],
): ScorerCandidate {
    return { schemaName, actionName, keywords: new Set(keywords) };
}

function vector(entries: Record<string, number>): ContextVector {
    return new Map(Object.entries(entries));
}

describe("contextSelector/scorer (TF-IDF, candidate-local IDF)", () => {
    it("scores tokens unique to a candidate with disc=1", () => {
        const c = vector({ spreadsheet: 2, grocery: 3 });
        const scores = scorer.score(c, [
            cand("excel", "addRow", ["spreadsheet", "cell"]),
            cand("list", "addItems", ["grocery", "todo"]),
        ]);
        const excel = scores.find((s) => s.schemaName === "excel")!;
        const list = scores.find((s) => s.schemaName === "list")!;
        expect(excel.score).toBeCloseTo(2, 5); // only spreadsheet in context
        expect(excel.uniqueTokenCount).toBe(1);
        expect(list.score).toBeCloseTo(3, 5);
    });

    it("cancels a token shared by all candidates (disc=0)", () => {
        const c = vector({ shared: 5, spreadsheet: 2, grocery: 4 });
        const scores = scorer.score(c, [
            cand("excel", "addRow", ["shared", "spreadsheet"]),
            cand("list", "addItems", ["shared", "grocery"]),
        ]);
        const excel = scores.find((s) => s.schemaName === "excel")!;
        // "shared" (disc=0) contributes nothing; only "spreadsheet".
        expect(excel.score).toBeCloseTo(2, 5);
        expect(excel.uniqueTokenCount).toBe(1);
        // Shared token still appears in the matched detail with disc 0.
        const sharedMatch = excel.matched!.find((m) => m.token === "shared")!;
        expect(sharedMatch.disc).toBeCloseTo(0, 5);
        expect(sharedMatch.contribution).toBeCloseTo(0, 5);
    });

    it("graduates disc for a token shared by 2 of 3 candidates", () => {
        const c = vector({ item: 10 });
        const scores = scorer.score(c, [
            cand("a", "x", ["item"]),
            cand("b", "y", ["item"]),
            cand("c", "z", ["other"]),
        ]);
        // disc(item) = log(3/2)/log(3)
        const expected = 10 * (Math.log(3 / 2) / Math.log(3));
        const a = scores.find((s) => s.schemaName === "a")!;
        expect(a.score).toBeCloseTo(expected, 5);
    });

    it("ignores candidate keywords absent from the context vector", () => {
        const c = vector({ spreadsheet: 1 });
        const scores = scorer.score(c, [
            cand("excel", "addRow", ["spreadsheet", "pivot", "chart"]),
            cand("list", "addItems", ["grocery"]),
        ]);
        const excel = scores.find((s) => s.schemaName === "excel")!;
        expect(excel.uniqueTokenCount).toBe(1); // only spreadsheet matched
    });

    it("sorts matched tokens by token for stable telemetry", () => {
        const c = vector({ zebra: 1, apple: 1, mango: 1 });
        const [only] = scorer.score(c, [
            cand("a", "x", ["zebra", "apple", "mango"]),
            cand("b", "y", ["other"]),
        ]);
        expect(only.matched!.map((m) => m.token)).toEqual([
            "apple",
            "mango",
            "zebra",
        ]);
    });
});
