// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "node:module";
import type { Prices } from "./types.js";

const require = createRequire(import.meta.url);

export interface PriceTable {
    source: string;
    version: string;
    unit?: string;
    rates: Record<string, Prices>;
}

export const PRICES: PriceTable =
    require("./model-prices.generated.json") as PriceTable;

export function pricesFor(model: string): {
    prices: Prices | undefined;
    table: PriceTable;
} {
    const table: PriceTable = { ...PRICES, rates: { ...PRICES.rates } };
    const prices = table.rates[model] ?? table.rates[model.replace(/\*$/, "")];
    return { prices, table };
}
