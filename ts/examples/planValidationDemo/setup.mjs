// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Expands {{projectDir}} in .plan-validation-policy.template.json to the
// absolute path of this directory (with forward slashes) and writes the
// result to .plan-validation-policy.json. Idempotent — safe to re-run.
//
// Usage:
//   node setup.mjs          generate the resolved policy
//   node setup.mjs --clean  remove the generated policy + any demo artifacts

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const template = resolve(here, ".plan-validation-policy.template.json");
const output = resolve(here, ".plan-validation-policy.json");
const artifacts = ["index.html", "style.css", "script.js"].map((f) =>
    resolve(here, f),
);

if (process.argv.includes("--clean")) {
    for (const p of [output, ...artifacts]) {
        if (existsSync(p)) {
            unlinkSync(p);
            console.log(`removed ${p}`);
        }
    }
    process.exit(0);
}

const projectDir = here.replace(/\\/g, "/");
const resolved = readFileSync(template, "utf-8").replace(
    /\{\{projectDir\}\}/g,
    projectDir,
);
writeFileSync(output, resolved, "utf-8");
console.log(`wrote ${output}`);
console.log(`  projectDir = ${projectDir}`);
