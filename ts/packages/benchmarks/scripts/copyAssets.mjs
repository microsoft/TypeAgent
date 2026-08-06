// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Copy non-TS assets next to compiled output (tsc does not emit .json/.yaml). */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const assets = [
    [
        "src/translationBench/catalog.generated.json",
        "dist/translationBench/catalog.generated.json",
    ],
    [
        "src/translationBench/action-parameters-grader.generated.json",
        "dist/translationBench/action-parameters-grader.generated.json",
    ],
    [
        "src/core/model-prices.generated.json",
        "dist/core/model-prices.generated.json",
    ],
];

/** Copy every file under srcDir into dstDir (flat; no recursion). */
function copyDirFlat(srcRel, dstRel, extensions) {
    const srcDir = path.join(root, srcRel);
    if (!existsSync(srcDir)) {
        return;
    }
    const dstDir = path.join(root, dstRel);
    mkdirSync(dstDir, { recursive: true });
    for (const name of readdirSync(srcDir)) {
        const from = path.join(srcDir, name);
        if (!statSync(from).isFile()) {
            continue;
        }
        if (
            extensions !== undefined &&
            !extensions.some((ext) => name.endsWith(ext))
        ) {
            continue;
        }
        copyFileSync(from, path.join(dstDir, name));
    }
}

// Parameter-grader prompt YAML (and any sibling prompt packs)
copyDirFlat(
    "src/translationBench/synthesizer",
    "dist/translationBench/synthesizer",
    [".yaml", ".yml"],
);

for (const [fromRel, toRel] of assets) {
    const from = path.join(root, fromRel);
    if (!existsSync(from)) {
        continue;
    }
    const to = path.join(root, toRel);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
}
