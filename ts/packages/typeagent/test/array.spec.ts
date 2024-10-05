// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections } from "../src/index.js";

describe("collections.array", () => {
    test("getInRange", () => {
        const items = [];
        for (let i = 1; i <= 20; ++i) {
            items.push(i);
        }
        let range = collections.getInRange(items, 5, 15, cmp);
        checkRange(range, 11, 5, 15);

        range = collections.getInRange(items, 1, 4, cmp);
        checkRange(range, 4, 1, 4);

        range = collections.getInRange(items, 10, 15, cmp);
        checkRange(range, 6, 10, 15);

        range = collections.getInRange(items, 10, 25, cmp);
        checkRange(range, 11, 10, 20);

        range = collections.getInRange(items, 0, 25, cmp);
        checkRange(range, 20, 1, 20);

        range = collections.getInRange(items, 0, undefined, cmp);
        checkRange(range, 20, 1);

        range = collections.getInRange(items, 25, undefined, cmp);
        checkRange(range, 0);

        range = collections.getInRange(items, 25, 28, cmp);
        checkRange(range, 0);
    });
    test("getInRange.dupes", () => {
        const items = [];
        const dupeCount = 4;
        for (let i = 1; i <= 20; ++i) {
            for (let j = 0; j < dupeCount; ++j) {
                items.push(i);
            }
        }
        let range = collections.getInRange(items, 1, 1, cmp);
        checkRange(range, 1 * dupeCount, 1, 1);

        range = collections.getInRange(items, 1, 3, cmp);
        checkRange(range, 3 * dupeCount, 1, 3);

        range = collections.getInRange(items, 5, 15, cmp);
        checkRange(range, 11 * dupeCount, 5, 15);

        range = collections.getInRange(items, 1, 4, cmp);
        checkRange(range, 4 * dupeCount, 1, 4);

        range = collections.getInRange(items, 10, 15, cmp);
        checkRange(range, 6 * dupeCount, 10, 15);

        range = collections.getInRange(items, 10, 25, cmp);
        checkRange(range, 11 * dupeCount, 10, 20);

        range = collections.getInRange(items, 0, 25, cmp);
        checkRange(range, 20 * dupeCount, 1, 20);

        range = collections.getInRange(items, 25, undefined, cmp);
        checkRange(range, 0);

        range = collections.getInRange(items, 25, 28, cmp);
        checkRange(range, 0);

        range = collections.getInRange(items, 20, undefined, cmp);
        checkRange(range, 1 * dupeCount, 20);

        range = collections.getInRange(items, 20, 20, cmp);
        checkRange(range, 1 * dupeCount, 20);
    });
    test("concatArray", () => {
        const a = [1, 2, 3];
        const b = [4, 5];
        const c = undefined;
        const d = undefined;
        let concat = collections.concatArrays(a, b);
        expect(concat).toHaveLength(a.length + b.length);
        concat = collections.concatArrays(b, c);
        expect(concat).toHaveLength(b.length);
        concat = collections.concatArrays(c, d);
        expect(concat).toHaveLength(0);
    });
    function cmp(x: number, y: number) {
        return x - y;
    }

    function checkRange(
        range: any[],
        length: number,
        first?: number,
        last?: number,
    ) {
        expect(range).toHaveLength(length);
        if (first) {
            expect(range[0]).toBe(first);
        }
        if (last) {
            expect(range[range.length - 1]).toBe(last);
        }
    }
});
