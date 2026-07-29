// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Codemod: rename internal libs to the @typeagent/* scope so they can be
// published to the feed. Reversible via git. Run:
//   node tools/scripts/scopeInternalLibs.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DRY = process.argv.includes("--dry");
const TS_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

// current bare name -> new scoped name
const RENAME = {
    "azure-ai-foundry": "@typeagent/azure-ai-foundry",
    "chat-ui": "@typeagent/chat-ui",
    "conversation-memory": "@typeagent/conversation-memory",
    "knowledge-processor": "@typeagent/knowledge-processor",
    knowpro: "@typeagent/knowpro",
    "memory-storage": "@typeagent/memory-storage",
    "taskflow-typeagent": "@typeagent/taskflow-typeagent",
    telemetry: "@typeagent/telemetry",
    textpro: "@typeagent/textpro",
    typeagent: "@typeagent/agent-runtime",
    "typechat-utils": "@typeagent/typechat-utils",
    "website-memory": "@typeagent/website-memory",
    "websocket-channel-server": "@typeagent/websocket-channel-server",
    "image-memory": "@typeagent/image-memory",
};

const CODE_EXT = new Set([
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".mjs",
    ".cjs",
]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === "dist" || e.name === ".git")
            continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

const files = walk(TS_ROOT);
let pkgNameChanges = 0;
let depKeyChanges = 0;
let importChanges = 0;
const changedFiles = new Set();

const rules = Object.entries(RENAME).map(([from, to]) => {
    const f = esc(from);
    return {
        from,
        to,
        // import/export ... from "<spec>"
        fromRe: new RegExp(`(from\\s*['"])${f}(/[^'"]*)?(['"])`, "g"),
        // side-effect import "<spec>", dynamic import("<spec>"), require("<spec>"), *.mock("<spec>")
        callRe: new RegExp(
            `((?:\\bimport|\\brequire|\\bmock)\\s*\\(?\\s*['"])${f}(/[^'"]*)?(['"])`,
            "g",
        ),
        // package.json dependency KEY: "<name>": "<string-value>"  (string value excludes config object blocks)
        depRe: new RegExp(`(['"])${f}(['"])(\\s*:\\s*)(['"])`, "g"),
        // ambient declaration: declare module "<spec>"
        declRe: new RegExp(
            `(declare\\s+module\\s*['"])${f}(/[^'"]*)?(['"])`,
            "g",
        ),
    };
});

for (const file of files) {
    const base = path.basename(file);
    const ext = path.extname(file);
    const isPkgJson = base === "package.json";
    const isCode = CODE_EXT.has(ext);
    if (!isPkgJson && !isCode) continue;

    let text = fs.readFileSync(file, "utf8");
    const orig = text;

    if (isPkgJson) {
        try {
            const j = JSON.parse(text);
            if (j.name && RENAME[j.name]) {
                const newName = RENAME[j.name];
                text = text.replace(
                    new RegExp(`("name"\\s*:\\s*")${esc(j.name)}(")`),
                    `$1${newName}$2`,
                );
                text = text.replace(/("private"\s*:\s*)true/, "$1false");
                pkgNameChanges++;
            }
        } catch {
            /* ignore malformed */
        }
        for (const r of rules) {
            text = text.replace(r.depRe, (m, q1, q2, colon, vq) => {
                depKeyChanges++;
                return `${q1}${r.to}${q2}${colon}${vq}`;
            });
        }
    }

    if (isCode) {
        for (const r of rules) {
            text = text.replace(r.fromRe, (m, pre, sub, post) => {
                importChanges++;
                return `${pre}${r.to}${sub ?? ""}${post}`;
            });
            text = text.replace(r.callRe, (m, pre, sub, post) => {
                importChanges++;
                return `${pre}${r.to}${sub ?? ""}${post}`;
            });
            text = text.replace(r.declRe, (m, pre, sub, post) => {
                importChanges++;
                return `${pre}${r.to}${sub ?? ""}${post}`;
            });
        }
    }

    if (text !== orig) {
        changedFiles.add(file);
        if (!DRY) fs.writeFileSync(file, text);
    }
}

console.log(
    `${DRY ? "[DRY] " : ""}package name/private updated: ${pkgNameChanges}`,
);
console.log(
    `${DRY ? "[DRY] " : ""}dependency keys renamed:      ${depKeyChanges}`,
);
console.log(
    `${DRY ? "[DRY] " : ""}import specifiers rewritten:  ${importChanges}`,
);
console.log(
    `${DRY ? "[DRY] " : ""}files changed:                ${changedFiles.size}`,
);
