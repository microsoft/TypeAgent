// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { writeFileSync } from "node:fs";

const API_URL = "https://models.dev/api.json";

/** OpenAI model ids to pin (models.dev `openai` provider). */
const MODELS = [
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
] as const;

interface Cost {
    input?: number;
    output?: number;
    cache_read?: number;
}

async function main(): Promise<void> {
    const res = await fetch(API_URL, {
        headers: { "User-Agent": "typeagent-benchmarks/1.0" },
    });
    if (!res.ok) {
        throw new Error(`${API_URL} -> ${res.status} ${res.statusText}`);
    }
    const catalog = (await res.json()) as Record<
        string,
        { models?: Record<string, { cost?: Cost }> }
    >;
    const openai = catalog.openai?.models;
    if (!openai) {
        throw new Error("models.dev response missing openai.models");
    }

    const rates: Record<
        string,
        { inUsdPer1M: number; cachedUsdPer1M: number; outUsdPer1M: number }
    > = {};
    const missing: string[] = [];

    for (const id of MODELS) {
        const cost = openai[id]?.cost;
        if (
            typeof cost?.input !== "number" ||
            typeof cost?.output !== "number"
        ) {
            missing.push(id);
            continue;
        }
        rates[id] = {
            inUsdPer1M: cost.input,
            cachedUsdPer1M:
                typeof cost.cache_read === "number"
                    ? cost.cache_read
                    : cost.input,
            outUsdPer1M: cost.output,
        };
    }

    if (missing.length > 0) {
        throw new Error(`models.dev missing cost for: ${missing.join(", ")}`);
    }

    const outPath = process.argv[2] ?? "src/core/model-prices.generated.json";
    writeFileSync(
        outPath,
        `${JSON.stringify(
            {
                source: API_URL,
                version: new Date().toISOString(),
                unit: "USD per 1M tokens",
                provider: "openai",
                rates,
            },
            null,
            2,
        )}\n`,
    );
    process.stderr.write(
        `[snapshotPrices] wrote ${outPath}: ${MODELS.length} models (${MODELS.join(", ")})\n`,
    );
}

main().then(
    () => process.exit(0),
    (e) => {
        process.stderr.write(`snapshotPrices failed: ${e}\n`);
        process.exit(1);
    },
);
