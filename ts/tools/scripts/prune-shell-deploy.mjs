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
 *   1. The native CLI packages for @github/copilot and
 *      @anthropic-ai/claude-agent-sdk (~250MB and ~230MB per platform). The
 *      connect-only shell delegates ALL model work to the agent-server (speech
 *      classification, translation, embeddings), so it never spawns these host
 *      CLIs — every platform-native package is dropped. The small JS wrapper
 *      packages (@github/copilot, @github/copilot-sdk) are kept so aiclient's
 *      lazy `import()` still resolves in the unlikely event it is reached; the
 *      native is only required on first model use, which never happens here.
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

// Leaf package directory names to delete outright (exact logical paths).
const leafTargets = [
    "onnxruntime-node",
    "onnxruntime-web",
    "@huggingface/transformers",
];

// Platform-native packages for the host CLIs, keyed by scope/base prefix. Any
// package whose logical name starts with one of these (e.g.
// `@github/copilot-win32-x64`, `@anthropic-ai/claude-agent-sdk-linux-arm64`)
// is a per-platform native and is dropped for EVERY os/arch. The exact base
// names in `keepExact` (the JS wrappers) are preserved.
const nativePrefixes = [
    "@github/copilot-",
    "@anthropic-ai/claude-agent-sdk-",
];
const keepExact = new Set([
    "@github/copilot-sdk", // JS SDK wrapper (small)
]);

// Recognizes a platform-native suffix like `-win32-x64` / `-linux-arm64` /
// `-darwin-x64`, so only per-platform native packages match — never the JS
// wrapper packages (`@github/copilot`, `@github/copilot-sdk`, etc.).
const platformSuffix = /-(win32|darwin|linux)-(x64|arm64|ia32)$/;

// The same leaf targets as pnpm mangles them in the .pnpm store, e.g.
// `onnxruntime-node@1.21.0`.
const pnpmPrefixes = leafTargets.map((t) => `${t.replace("/", "+")}@`);
// Mangled store prefixes for the platform natives, e.g.
// `@github+copilot-win32-x64@1.0.69`.
const pnpmNativePrefixes = nativePrefixes.map((t) => t.replace("/", "+"));
const pnpmKeepPrefixes = [...keepExact].map((t) => `${t.replace("/", "+")}@`);

function isNativeLeaf(rel) {
    // rel is a logical node_modules path; the trailing 1-2 segments form the
    // scoped package name. Match `<prefix>...-<os>-<arch>` platform natives,
    // but never a kept wrapper.
    return nativePrefixes.some((prefix) => {
        const idx = rel.indexOf(prefix);
        if (idx === -1) {
            return false;
        }
        const name = rel.slice(idx);
        if (keepExact.has(name)) {
            return false;
        }
        return platformSuffix.test(name);
    });
}

function isNativeStoreDir(baseName) {
    if (pnpmKeepPrefixes.some((p) => baseName.startsWith(p))) {
        return false;
    }
    if (!pnpmNativePrefixes.some((p) => baseName.startsWith(p))) {
        return false;
    }
    // pnpm store dir is `<mangled-name>@<version>`; strip the version and
    // require a platform suffix so only per-platform natives match.
    const nameOnly = baseName.replace(/@[^@]*$/, "");
    return platformSuffix.test(nameOnly);
}

function matches(relFromNodeModules, baseName) {
    // Exact logical leaf (local-embedding runtime), at the root of node_modules
    // or nested inside a consuming package's node_modules.
    if (
        leafTargets.some(
            (t) =>
                relFromNodeModules === t ||
                relFromNodeModules.endsWith(`/${t}`),
        )
    ) {
        return true;
    }
    // Per-platform host CLI natives (any os/arch).
    if (isNativeLeaf(relFromNodeModules)) {
        return true;
    }
    // The real store directories, mangled by pnpm.
    if (pnpmPrefixes.some((p) => baseName.startsWith(p))) {
        return true;
    }
    return isNativeStoreDir(baseName);
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
    `prune-shell-deploy: pruning ${nodeModules} (dropping @github/copilot + @anthropic-ai/claude-agent-sdk platform natives and the local-embedding runtime; connect-only shell delegates all model work to the agent-server)`,
);
walk(nodeModules, "");
console.log(
    `prune-shell-deploy: done (~${(deletedBytes / 1024 / 1024).toFixed(0)} MB of real files removed).`,
);
