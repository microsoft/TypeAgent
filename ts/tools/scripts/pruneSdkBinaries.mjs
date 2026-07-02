#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Prune the bundled Claude Code / GitHub Copilot CLI runtimes from a deploy
 * artifact, for an "external-CLI" variant that resolves `claude`/`copilot` from
 * PATH instead (see #8 / the agent-SDK CLI-path wiring).
 *
 * Safe ONLY when:
 *   (1) every runtime `query()` caller passes pathToClaudeCodeExecutable (we wire
 *       them via claudeExecutableOption()), AND
 *   (2) `claude` and `copilot` are guaranteed on PATH in the target environment
 *       (managed machines; the standalone installer provisions them).
 * Otherwise the SDKs lose their bundled binary with no fallback. This is why it
 * is opt-in (deployAgentServer --external-cli), never the default artifact.
 *
 * Removes the bundled CLI runtimes; KEEPS the JS SDKs (which are imported):
 *   remove: @anthropic-ai/claude-agent-sdk-<rid>, @github/copilot, @github/copilot-<rid>
 *   keep:   @anthropic-ai/claude-agent-sdk, @anthropic-ai/sdk, @github/copilot-sdk
 *
 * Usage:
 *   node tools/scripts/pruneSdkBinaries.mjs --dir <deployDir> [--dry-run]
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
    const args = { dryRun: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dir") args.dir = argv[++i];
        else if (a === "--dry-run") args.dryRun = true;
        else throw new Error(`Unknown argument: ${a}`);
    }
    if (!args.dir) throw new Error("Missing --dir <deployDir>.");
    args.dir = path.resolve(args.dir);
    return args;
}

// JS SDKs that are imported and must stay.
const KEEP = new Set([
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/sdk",
    "@github/copilot-sdk",
]);

// A package is a bundled CLI runtime (removable) if it's one of these.
function isBundledRuntime(name) {
    if (KEEP.has(name)) return false;
    return (
        name.startsWith("@anthropic-ai/claude-agent-sdk-") ||
        name === "@github/copilot" ||
        name.startsWith("@github/copilot-")
    );
}

function dirSizeBytes(dir) {
    let total = 0;
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) total += dirSizeBytes(full);
        else if (e.isFile()) {
            try {
                total += fs.statSync(full).size;
            } catch {
                /* ignore */
            }
        }
    }
    return total;
}

function fmt(bytes) {
    const mb = bytes / (1024 * 1024);
    return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function main() {
    const args = parseArgs(process.argv);
    const nm = path.join(args.dir, "node_modules");
    const scopes = ["@anthropic-ai", "@github"];
    let freed = 0;
    const removed = [];
    for (const scope of scopes) {
        const scopeDir = path.join(nm, scope);
        if (!fs.existsSync(scopeDir)) continue;
        for (const entry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const name = `${scope}/${entry.name}`;
            if (!isBundledRuntime(name)) continue;
            const dir = path.join(scopeDir, entry.name);
            const size = dirSizeBytes(dir);
            freed += size;
            removed.push({ name, size });
            if (!args.dryRun) fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    removed.sort((a, b) => b.size - a.size);
    for (const r of removed) {
        console.log(
            `  ${args.dryRun ? "would remove" : "removed"}: ${r.name} (${fmt(r.size)})`,
        );
    }
    console.log(
        `${args.dryRun ? "Would free" : "Freed"} ${fmt(freed)} across ${removed.length} bundled-runtime package(s). ` +
            `(claude/copilot must be on PATH in the target environment.)`,
    );
}

main();
