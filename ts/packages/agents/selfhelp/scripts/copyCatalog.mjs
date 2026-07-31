// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copies the generated Action Browser catalog and the conceptual/setup docs into
// dist so they ship beside the agent (the runtime reads ./action-browser.json and
// ./docs/*.md relative to the built handler). Runs as part of build. Tolerant of
// missing sources so a fresh checkout whose docs have not been generated still
// builds; the runtime handles an absent catalog or docs gracefully.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoTs = resolve(here, "..", "..", "..", "..");
const destDir = resolve(here, "..", "dist");

const src = resolve(repoTs, "docs", "overview", "action-browser.json");
const dest = resolve(destDir, "action-browser.json");

if (existsSync(src)) {
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, dest);
    console.log(`copyCatalog: wrote ${dest}`);
} else {
    console.warn(
        `copyCatalog: source not found at ${src}; skipping (runtime handles an absent catalog).`,
    );
}

// Conceptual/setup docs used to ground the explainTypeAgent action. The overview
// index (the pinned "What is TypeAgent?" page) plus getting-started, keys, and
// per-platform setup. The command reference is intentionally excluded - it is a
// dump of the same commands the catalog already carries.
const docsDestDir = resolve(destDir, "docs");
const overviewDocs = [
    "index.md",
    "getting-started.md",
    "glossary.md",
    "surfaces.md",
    "service-keys.md",
    "setup-windows.md",
    "setup-macos.md",
    "setup-linux.md",
    "setup-wsl2.md",
    "developer-tips.md",
];

mkdirSync(docsDestDir, { recursive: true });
let copiedDocs = 0;
for (const name of overviewDocs) {
    const from = resolve(repoTs, "docs", "overview", name);
    if (existsSync(from)) {
        copyFileSync(from, resolve(docsDestDir, name));
        copiedDocs++;
    }
}
const readme = resolve(repoTs, "README.md");
if (existsSync(readme)) {
    copyFileSync(readme, resolve(docsDestDir, "README.md"));
    copiedDocs++;
}
console.log(`copyCatalog: wrote ${copiedDocs} doc(s) to ${docsDestDir}`);
