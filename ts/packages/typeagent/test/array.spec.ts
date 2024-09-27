// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { collections } from "../src/index.js";

describe("collections.array", () => {
    test("getInRange", () => {
        const items = [];
        for (let i = 1; i <= 20; ++i) {
            items.push(i);
        }
        let range = collections.getInRange(items, 5, 15, (x, y) => x - y);
        expect(range).toHaveLength(11);
        expect(range[0]).toBe(5);
        expect(range[range.length - 1]).toBe(15);
    });
});
