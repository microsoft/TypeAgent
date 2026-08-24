// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import { pricesFor } from "../src/core/prices.js";

describe("core prices", () => {
    it.each(["gpt-5.4", "gpt-5.4*", "azure/gpt-5.4", "azure/gpt-5.4*"])(
        "resolves %s",
        (model) => {
            expect(pricesFor(model).prices).toEqual({
                inUsdPer1M: 2.5,
                cachedUsdPer1M: 0.25,
                outUsdPer1M: 15,
            });
        },
    );

    it("does not reuse Azure rates for another provider", () => {
        expect(pricesFor("copilot/gpt-5.4").prices).toBeUndefined();
    });

    it("returns isolated price records", () => {
        const first = pricesFor("gpt-5.4");
        first.prices!.inUsdPer1M = 0;
        first.table.rates["gpt-4.1"].inUsdPer1M = 0;

        const second = pricesFor("gpt-5.4");

        expect(second.prices?.inUsdPer1M).toBe(2.5);
        expect(second.table.rates["gpt-4.1"].inUsdPer1M).toBe(2);
    });
});
