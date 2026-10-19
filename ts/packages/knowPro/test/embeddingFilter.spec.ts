import { EmbeddingIndex } from "../src/fuzzyIndex.js";

describe("filtered embedding search", () => {
    const query = new Float32Array([1, 0]);
    const vectors = [
        new Float32Array([1, 0]),
        new Float32Array([0.8, 0.6]),
        new Float32Array([0.6, 0.8]),
        new Float32Array([0, 1]),
    ];

    test.each([undefined, 0, 1, 2, 10])(
        "preserves eligible scores and ordering with maxMatches=%s",
        (maxMatches) => {
            const index = new EmbeddingIndex(vectors);
            const eligible = (ordinal: number) => ordinal % 2 === 1;
            const expected = index
                .getIndexesOfNearest(query, undefined, 0.1)
                .filter((match) => eligible(match.item));
            expect(
                index.getIndexesOfNearest(query, maxMatches, 0.1, eligible),
            ).toEqual(
                maxMatches && maxMatches > 0
                    ? expected.slice(0, maxMatches)
                    : expected,
            );
        },
    );

    test("does not access vectors rejected by the predicate", () => {
        const guardedVectors = [...vectors];
        Object.defineProperty(guardedVectors, 0, {
            get() {
                throw new Error("Rejected vector was scored");
            },
        });
        const index = new EmbeddingIndex(guardedVectors);
        expect(
            index.getIndexesOfNearest(query, 1, 0, (ordinal) => ordinal !== 0),
        ).toEqual([{ item: 1, score: vectors[1][0] }]);
    });

    test("an empty filter returns no matches", () => {
        expect(
            new EmbeddingIndex(vectors).getIndexesOfNearest(
                query,
                undefined,
                undefined,
                () => false,
            ),
        ).toEqual([]);
    });
});
