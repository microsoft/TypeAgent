// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    constants,
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirsMade = new Set();

function ensureDir(dir) {
    if (dirsMade.has(dir)) return;
    mkdirSync(dir, { recursive: true });
    dirsMade.add(dir);
}

/** Skip when dest exists with same size and mtime >= source (idempotent builds). */
function copyFileFast(from, to) {
    if (!existsSync(from)) return false;
    ensureDir(path.dirname(to));
    if (existsSync(to)) {
        const src = statSync(from);
        const dst = statSync(to);
        if (src.size === dst.size && dst.mtimeMs >= src.mtimeMs) {
            return false;
        }
    }
    copyFileSync(from, to, constants.COPYFILE_FICLONE);
    return true;
}

const files = [
    [
        "src/translationBench/catalog.generated.json",
        "dist/translationBench/catalog.generated.json",
    ],
    [
        "src/translationBench/action-parameters-grader.generated.json",
        "dist/translationBench/action-parameters-grader.generated.json",
    ],
    [
        "src/translationBench/eligible-gold-actions.generated.json",
        "dist/translationBench/eligible-gold-actions.generated.json",
    ],
    [
        "src/translationBench/config.schema.json",
        "dist/translationBench/config.schema.json",
    ],
    [
        "src/translationBench/config/run-config.example.json",
        "dist/translationBench/config/run-config.example.json",
    ],
    [
        "src/core/model-prices.generated.json",
        "dist/core/model-prices.generated.json",
    ],
];

const requiredGenerated = new Set([
    "src/translationBench/catalog.generated.json",
    "src/translationBench/action-parameters-grader.generated.json",
    "src/translationBench/eligible-gold-actions.generated.json",
    "src/translationBench/policy/action-eligibility.json",
]);
for (const [fromRel, toRel] of files) {
    const from = path.join(root, fromRel);
    if (requiredGenerated.has(fromRel) && !existsSync(from)) {
        throw new Error(`copyAssets: missing required asset ${fromRel}`);
    }
    copyFileFast(from, path.join(root, toRel));
}

const yamlSrc = path.join(root, "src/translationBench/synthesizer");
const yamlDst = path.join(root, "dist/translationBench/synthesizer");
if (existsSync(yamlSrc)) {
    for (const name of readdirSync(yamlSrc, { withFileTypes: true })) {
        if (!name.isFile()) continue;
        if (!name.name.endsWith(".yaml") && !name.name.endsWith(".yml")) {
            continue;
        }
        copyFileFast(
            path.join(yamlSrc, name.name),
            path.join(yamlDst, name.name),
        );
    }
}

const policyFiles = [
    [
        "src/translationBench/policy/action-eligibility.json",
        "dist/translationBench/policy/action-eligibility.json",
    ],
    [
        "src/translationBench/policy/action-eligibility.schema.json",
        "dist/translationBench/policy/action-eligibility.schema.json",
    ],
];
for (const [fromRel, toRel] of policyFiles) {
    const from = path.join(root, fromRel);
    if (!existsSync(from)) {
        throw new Error(`copyAssets: missing required asset ${fromRel}`);
    }
    copyFileFast(from, path.join(root, toRel));
}

const policyYamlSrc = path.join(root, "src/translationBench/policy");
const policyYamlDst = path.join(root, "dist/translationBench/policy");
if (existsSync(policyYamlSrc)) {
    for (const name of readdirSync(policyYamlSrc, { withFileTypes: true })) {
        if (!name.isFile()) continue;
        if (!name.name.endsWith(".yaml") && !name.name.endsWith(".yml")) {
            continue;
        }
        copyFileFast(
            path.join(policyYamlSrc, name.name),
            path.join(policyYamlDst, name.name),
        );
    }
}

const seedSrc = path.join(root, "src/translationBench/synthesizer/seed");
const seedDst = path.join(root, "dist/translationBench/synthesizer/seed");
if (existsSync(seedSrc)) {
    for (const name of readdirSync(seedSrc, { withFileTypes: true })) {
        if (!name.isFile()) continue;
        copyFileFast(
            path.join(seedSrc, name.name),
            path.join(seedDst, name.name),
        );
    }
}
