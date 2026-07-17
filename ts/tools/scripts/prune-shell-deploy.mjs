// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * prune-shell-deploy - trim the shell's `pnpm deploy` output before packaging.
 *
 * Run after `pnpm --filter=agent-shell deploy --prod ./deploy` (see the
 * shell's `deploy:app` script). Physically deletes packages that the shipped
 * connect-only shell does not need, which electron-builder's `files` filter
 * cannot reliably drop (a bare `!` negation on a node_modules subpath collapses
 * the whole package/scope, and re-include globs do not resurrect it):
 *
 *   1. The non-host-arch native CLI packages for @github/copilot and
 *      @anthropic-ai/claude-agent-sdk (~240MB each). Only the arch being
 *      packaged is kept.
 *   2. The local-embedding runtime (onnxruntime-node, onnxruntime-web,
 *      @huggingface/transformers, ~340MB). The connect-only shell offloads
 *      embeddings to the agent-server; aiclient loads these lazily via guarded
 *      dynamic import (failures surface as a failed Result, never throw).
 *
 * Deleting the real .pnpm store directories reclaims the space; matching
 * symlinks (which would otherwise dangle) are removed too so electron-builder's
 * node_modules traversal never follows them.
 *
 * Usage: node prune-shell-deploy.mjs <deployDir>
 */

import fs from "node:fs";
import path from "node:path";

const deployDir = process.argv[2] ?? "./deploy";
const nodeModules = path.join(deployDir, "node_modules");

if (!fs.existsSync(nodeModules)) {
    console.error(
        `prune-shell-deploy: ${nodeModules} not found; nothing to do.`,
    );
    process.exit(0);
}

const hostOs = process.platform; // "win32" | "darwin" | "linux"
const hostArch =
    process.env.ELECTRON_BUILDER_ARCH?.trim() ||
    (process.arch === "arm64" ? "arm64" : "x64");
const otherArch = hostArch === "arm64" ? "x64" : "arm64";

// Leaf package directory names to delete (the logical node_modules layout).
const leafTargets = [
    `@github/copilot-${hostOs}-${otherArch}`,
    `@anthropic-ai/claude-agent-sdk-${hostOs}-${otherArch}`,
    "onnxruntime-node",
    "onnxruntime-web",
    "@huggingface/transformers",
];

// The same packages as pnpm mangles them in the .pnpm store, e.g.
// `@github+copilot-win32-arm64@1.0.69` or `onnxruntime-node@1.21.0`.
const pnpmPrefixes = leafTargets.map(
    (t) => `${t.replace("/", "+")}@`, // "@github/copilot-..." -> "@github+copilot-...@"
);

function matches(relFromNodeModules, baseName) {
    // Logical leaf path, either at the root of node_modules or nested inside a
    // consuming package's node_modules (e.g. a symlink at
    // .pnpm/<consumer>/node_modules/@huggingface/transformers).
    if (
        leafTargets.some(
            (t) =>
                relFromNodeModules === t ||
                relFromNodeModules.endsWith(`/${t}`),
        )
    ) {
        return true;
    }
    // The real store directory, mangled by pnpm (e.g. onnxruntime-node@1.21.0).
    return pnpmPrefixes.some((p) => baseName.startsWith(p));
}

let deletedBytes = 0;

function dirSize(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
            continue;
        }
        if (entry.isDirectory()) {
            total += dirSize(full);
        } else {
            try {
                total += fs.statSync(full).size;
            } catch {
                // ignore
            }
        }
    }
    return total;
}

function remove(full, relFromNodeModules) {
    const isLink = fs.lstatSync(full).isSymbolicLink();
    if (!isLink) {
        try {
            deletedBytes += dirSize(full);
        } catch {
            // ignore sizing errors
        }
    }
    fs.rmSync(full, { recursive: true, force: true });
    console.log(
        `  removed ${isLink ? "link " : "dir  "} node_modules/${relFromNodeModules}`,
    );
}

// Walk node_modules. Match on the logical leaf path (scope/name) and on the
// mangled .pnpm directory names; do not descend into a matched entry.
function walk(dir, relPrefix) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        const isLink = entry.isSymbolicLink();
        if (matches(rel, entry.name)) {
            remove(full, rel);
            continue;
        }
        if (isLink) {
            continue; // never follow symlinks
        }
        if (entry.isDirectory()) {
            walk(full, rel);
        }
    }
}

console.log(
    `prune-shell-deploy: pruning ${nodeModules} (host ${hostOs}/${hostArch}, dropping ${hostOs}/${otherArch} CLIs + local-embedding runtime)`,
);
walk(nodeModules, "");
console.log(
    `prune-shell-deploy: done (~${(deletedBytes / 1024 / 1024).toFixed(0)} MB of real files removed).`,
);
