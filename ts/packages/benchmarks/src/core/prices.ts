// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "node:module";
import type { Prices } from "./types.js";

const require = createRequire(import.meta.url);

export interface PriceTable {
    unit?: string;
    provider?: string;
    rates: Record<string, Prices>;
}

export const PRICES: PriceTable =
    require("./model-prices.generated.json") as PriceTable;

export function pricesFor(model: string): {
    prices: Prices | undefined;
    table: PriceTable;
} {
    const rates = Object.fromEntries(
        Object.entries(PRICES.rates).map(([name, prices]) => [
            name,
            { ...prices },
        ]),
    );
    const table: PriceTable = { ...PRICES, rates };
    const lookupModel = model.replace(/^azure\//, "").replace(/\*$/, "");
    const prices = table.rates[model] ?? table.rates[lookupModel];
    return { prices, table };
}
