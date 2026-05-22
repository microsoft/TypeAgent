// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Phase 0 dep-cycle audit.
 *
 * The workflow LSP must not pull `aiclient` (or any other runtime
 * AI-side dependency) into the shipped server bundle. We import task
 * schemas through `workflow-engine/schemas`, a sub-export that
 * sidesteps the engine's barrel re-exports of `builtinTasks.ts`
 * (which transitively imports `aiclient`).
 *
 * This script greps the bundled server for forbidden module strings
 * and exits non-zero on a hit. Wired into `npm run build` so a
 * regression breaks CI immediately.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const bundle = resolve(process.cwd(), "dist/server.js");

if (!existsSync(bundle)) {
    console.error(`bundle not found: ${bundle}`);
    process.exit(1);
}

const forbidden = ["aiclient/dist", "@azure/openai", "@azure/identity"];

const text = readFileSync(bundle, "utf8");
const hits = forbidden.filter((needle) => text.includes(needle));

if (hits.length > 0) {
    console.error(
        `dep-cycle-audit: forbidden modules leaked into server bundle: ${hits.join(", ")}`,
    );
    process.exit(1);
}

console.log(
    `dep-cycle-audit: clean (no forbidden modules in ${(text.length / 1024).toFixed(1)}KB bundle)`,
);
