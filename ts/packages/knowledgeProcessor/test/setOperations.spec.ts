// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHitTable, unionMerge } from "../src/setOperations.js";

describe("Set Operations", () => {
    test("UnionMerge_String", () => {
        let x = ["1", "2", "1234", "1235"].sort();
        let y = ["1", "1235", "1236", "2100"].sort();
        let merged = [...unionMerge(x, y)];
        // String sorts are lexically ordered
        let expected = ["1", "2", "1234", "1235", "1236", "2100"].sort();
        expect(merged).toEqual(expected);
    });
    test("UnionMerge_Number", () => {
        let x = [1, 2, 1234, 1235];
        let y = [1, 1235, 1236, 2100];
        let merged = [...unionMerge(x, y)];
        let expected = [1, 2, 1234, 1235, 1236, 2100];
        expect(merged).toEqual(expected);
    });
});

// Tests for HitTable.getTop() and getTopK() - covers TODO:587 and TODO:606 (Optimize)
describe("HitTable", () => {
    test("getTop returns empty array when table is empty", () => {
        const table = createHitTable<string>();
        expect(table.getTop()).toEqual([]);
    });

    test("getTop returns single item when table has one entry", () => {
        const table = createHitTable<string>();
        table.add("a", 1.0);
        expect(table.getTop()).toEqual(["a"]);
    });

    test("getTop returns only the highest-scoring item", () => {
        const table = createHitTable<string>();
        table.add("a", 0.5);
        table.add("b", 1.0);
        table.add("c", 0.3);
        expect(table.getTop()).toEqual(["b"]);
    });

    test("getTop returns all items tied for highest score", () => {
        const table = createHitTable<string>();
        table.add("a", 1.0);
        table.add("b", 1.0);
        table.add("c", 0.5);
        const top = table.getTop();
        expect(top).toHaveLength(2);
        expect(top).toContain("a");
        expect(top).toContain("b");
    });

    test("getTopK returns empty array when table is empty", () => {
        const table = createHitTable<string>();
        expect(table.getTopK(1)).toEqual([]);
    });

    test("getTopK with k=0 returns all items", () => {
        const table = createHitTable<string>();
        table.add("a", 0.5);
        table.add("b", 1.0);
        table.add("c", 0.3);
        const result = table.getTopK(0);
        expect(result).toHaveLength(3);
    });

    test("getTopK with k negative returns all items", () => {
        const table = createHitTable<string>();
        table.add("a", 0.5);
        table.add("b", 1.0);
        const result = table.getTopK(-1);
        expect(result).toHaveLength(2);
    });

    test("getTopK with k=1 returns only the top-scoring item", () => {
        const table = createHitTable<string>();
        table.add("a", 0.5);
        table.add("b", 1.0);
        table.add("c", 0.3);
        // TODO:606 - after optimization, the result must remain correct
        const result = table.getTopK(1);
        expect(result).toHaveLength(1);
        expect(result).toContain("b");
    });

    test("getTopK with k=2 returns items with top 2 distinct scores", () => {
        const table = createHitTable<string>();
        table.add("a", 1.0);
        table.add("b", 0.7);
        table.add("c", 0.3);
        // TODO:606 - after optimization, the result must remain correct
        const result = table.getTopK(2);
        expect(result).toHaveLength(2);
        expect(result).toContain("a");
        expect(result).toContain("b");
    });

    test("getTopK includes all tied items at a score boundary", () => {
        const table = createHitTable<string>();
        table.add("a", 1.0);
        table.add("b", 0.5);
        table.add("c", 0.5); // tied with b
        table.add("d", 0.1);
        // k=2 covers scores 1.0 and 0.5 - both b and c should be included at the boundary
        // TODO:606 - optimization must preserve this tied-score inclusivity
        const result = table.getTopK(2);
        expect(result).toHaveLength(3); // a + b + c (b and c are tied for rank 2)
        expect(result).toContain("a");
        expect(result).toContain("b");
        expect(result).toContain("c");
    });

    test("getTopK with k equal to table size returns all items", () => {
        const table = createHitTable<string>();
        table.add("a", 1.0);
        table.add("b", 0.5);
        table.add("c", 0.3);
        const result = table.getTopK(3);
        expect(result).toHaveLength(3);
    });

    test("byHighestScore returns all items sorted descending by score", () => {
        const table = createHitTable<string>();
        table.add("a", 0.3);
        table.add("b", 1.0);
        table.add("c", 0.6);
        const sorted = table.byHighestScore();
        expect(sorted).toHaveLength(3);
        expect(sorted[0].item).toBe("b");
        expect(sorted[1].item).toBe("c");
        expect(sorted[2].item).toBe("a");
    });
});
