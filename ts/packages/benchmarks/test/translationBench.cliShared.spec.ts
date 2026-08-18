// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import {
    defaultInstanceDir,
    parseCsvList,
} from "../src/translationBench/scripts/cliShared.js";

describe("translation bench shared CLI utilities", () => {
    it("normalizes comma-separated values", () => {
        expect(parseCsvList(" one, two ,,three ")).toEqual([
            "one",
            "two",
            "three",
        ]);
        expect(parseCsvList(" ")).toBeUndefined();
    });

    it("creates process-specific instance directories", () => {
        expect(defaultInstanceDir("eval")).toContain(`eval-${process.pid}`);
    });
});
