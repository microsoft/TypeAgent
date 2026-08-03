// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Copy non-TS assets next to compiled output (tsc does not emit .json). */
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const assets = [
    [
        "src/translationBench/catalog.generated.json",
        "dist/translationBench/catalog.generated.json",
    ],
    [
        "src/core/model-prices.generated.json",
        "dist/core/model-prices.generated.json",
    ],
];

for (const [fromRel, toRel] of assets) {
    const from = path.join(root, fromRel);
    const to = path.join(root, toRel);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
}
