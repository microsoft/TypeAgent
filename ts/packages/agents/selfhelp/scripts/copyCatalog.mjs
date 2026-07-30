// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copies the generated Action Browser catalog into dist so it ships beside the
// agent (the runtime reads ./action-browser.json relative to the built handler).
// Runs as part of build. Tolerant of a missing source so a fresh checkout whose
// docs have not been generated still builds; the runtime handles an absent
// catalog gracefully.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(
    here,
    "..",
    "..",
    "..",
    "..",
    "docs",
    "overview",
    "action-browser.json",
);
const destDir = resolve(here, "..", "dist");
const dest = resolve(destDir, "action-browser.json");

if (!existsSync(src)) {
    console.warn(
        `copyCatalog: source not found at ${src}; skipping (runtime handles an absent catalog).`,
    );
    process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`copyCatalog: wrote ${dest}`);
