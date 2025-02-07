// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { unionMerge } from "../src/setOperations.js";

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
