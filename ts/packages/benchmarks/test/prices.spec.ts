// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import { pricesFor } from "../src/core/prices.js";

describe("core prices", () => {
    it("resolves provider-prefixed wildcard model IDs", () => {
        expect(pricesFor("azure/gpt-5.4*").prices).toEqual({
            inUsdPer1M: 2.5,
            cachedUsdPer1M: 0.25,
            outUsdPer1M: 15,
        });
    });

    it("returns isolated price records", () => {
        const first = pricesFor("gpt-5.4").prices!;
        first.inUsdPer1M = 0;

        expect(pricesFor("gpt-5.4").prices?.inUsdPer1M).toBe(2.5);
    });
});
