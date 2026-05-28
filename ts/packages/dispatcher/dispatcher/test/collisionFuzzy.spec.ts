// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PlaceholderScorer,
    ActionEmbeddingScorer,
    selectFuzzyScorer,
    findFuzzyCollisions,
    isFuzzyCollisionForMatch,
    type ActionDescriptor,
    type FuzzyScorer,
} from "../src/translation/fuzzyCollision.js";

const a1: ActionDescriptor = { schemaName: "list", actionName: "addItems" };
const a2: ActionDescriptor = { schemaName: "list", actionName: "removeItems" };
const a3: ActionDescriptor = { schemaName: "vampire", actionName: "siphon" };
const a4: ActionDescriptor = { schemaName: "vampire", actionName: "addItems" };

class FakeScorer implements FuzzyScorer {
    constructor(private readonly map: Map<string, number>) {}
    async score(a: ActionDescriptor, b: ActionDescriptor) {
        const key = [
            `${a.schemaName}.${a.actionName}`,
            `${b.schemaName}.${b.actionName}`,
        ]
            .sort()
            .join("|");
        return this.map.get(key) ?? 0;
    }
}

describe("PlaceholderScorer", () => {
    it("returns 0 for any pair", async () => {
        const s = new PlaceholderScorer();
        expect(await s.score(a1, a2)).toBe(0);
        expect(await s.score(a1, a3)).toBe(0);
    });
});

describe("ActionEmbeddingScorer (stub)", () => {
    it("throws when called — implementation reserved for follow-up", async () => {
        const s = new ActionEmbeddingScorer();
        await expect(s.score(a1, a2)).rejects.toThrow(/not implemented/i);
    });
});

describe("selectFuzzyScorer", () => {
    it("returns a PlaceholderScorer for 'placeholder'", () => {
        expect(selectFuzzyScorer("placeholder")).toBeInstanceOf(
            PlaceholderScorer,
        );
    });

    it("falls back to PlaceholderScorer when 'actionEmbedding' is requested", () => {
        // The real ActionEmbeddingScorer is not implemented yet; selecting it
        // must degrade to placeholder rather than throwing at config time.
        const original = console.warn;
        const calls: unknown[][] = [];
        console.warn = (...args: unknown[]) => {
            calls.push(args);
        };
        try {
            const s = selectFuzzyScorer("actionEmbedding");
            expect(s).toBeInstanceOf(PlaceholderScorer);
            expect(calls.length).toBeGreaterThan(0);
        } finally {
            console.warn = original;
        }
    });
});

describe("findFuzzyCollisions", () => {
    it("returns [] with PlaceholderScorer regardless of threshold", async () => {
        const result = await findFuzzyCollisions(
            [a1, a2, a3],
            new PlaceholderScorer(),
            0.5,
        );
        expect(result).toEqual([]);
    });

    it("skips intra-schema pairs (siphon-vs-addItems within vampire)", async () => {
        const scorer = new FakeScorer(
            new Map([
                ["vampire.addItems|vampire.siphon", 0.99],
                ["list.addItems|vampire.addItems", 0.99],
            ]),
        );
        const result = await findFuzzyCollisions([a1, a3, a4], scorer, 0.85);
        // Only the cross-schema pair should be reported.
        expect(result).toHaveLength(1);
        const pair = result[0];
        expect([pair.a.schemaName, pair.b.schemaName].sort()).toEqual([
            "list",
            "vampire",
        ]);
    });

    it("filters out pairs below the threshold", async () => {
        const scorer = new FakeScorer(
            new Map([["list.addItems|vampire.siphon", 0.6]]),
        );
        const aboveThreshold = await findFuzzyCollisions([a1, a3], scorer, 0.5);
        expect(aboveThreshold).toHaveLength(1);
        const belowThreshold = await findFuzzyCollisions([a1, a3], scorer, 0.7);
        expect(belowThreshold).toHaveLength(0);
    });
});

describe("isFuzzyCollisionForMatch", () => {
    it("returns candidates from other schemas above the threshold", async () => {
        const scorer = new FakeScorer(
            new Map([
                ["list.addItems|vampire.siphon", 0.92],
                ["list.addItems|vampire.addItems", 0.4],
            ]),
        );
        const result = await isFuzzyCollisionForMatch(
            a1,
            [a1, a3, a4],
            scorer,
            0.85,
        );
        expect(result).toHaveLength(1);
        expect(result[0].candidate.schemaName).toBe("vampire");
        expect(result[0].candidate.actionName).toBe("siphon");
        expect(result[0].similarity).toBeGreaterThanOrEqual(0.85);
    });

    it("returns [] with PlaceholderScorer", async () => {
        const result = await isFuzzyCollisionForMatch(
            a1,
            [a1, a2, a3],
            new PlaceholderScorer(),
            0.5,
        );
        expect(result).toEqual([]);
    });
});
