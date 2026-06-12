#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Prune foreign-architecture native packages from a `pnpm deploy` output so a
 * per-RID agent-server artifact only carries binaries for its target platform.
 *
 * Why: the agent-server's dependency closure includes packages that ship
 * prebuilt native binaries as per-platform optional sub-packages (e.g.
 * `@github/copilot-win32-x64` + `@github/copilot-win32-arm64`,
 * `@anthropic-ai/claude-agent-sdk-win32-*`, `@napi-rs/canvas-win32-*-msvc`,
 * `@img/sharp-<os>-<arch>`, `@esbuild/<os>-<arch>`, ...). pnpm installs every
 * platform variant, so a naive `pnpm deploy --prod` carries binaries for arches
 * the artifact will never run on. Removing the non-target variants is safe — the
 * consuming package selects the matching-arch sub-package at runtime, and the
 * others are dead weight.
 *
 * This does NOT touch JS-only packages or the target-arch binaries, so a server
 * that boots before pruning still boots after.
 *
 * Usage:
 *   node tools/scripts/pruneDeploy.mjs --dir <deployDir> [--platform win32] [--arch x64] [--dry-run]
 *   (platform/arch default to the host's process.platform / process.arch.)
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
    const args = { dryRun: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dir") args.dir = argv[++i];
        else if (a === "--platform") args.platform = argv[++i];
        else if (a === "--arch") args.arch = argv[++i];
        else if (a === "--dry-run") args.dryRun = true;
        else throw new Error(`Unknown argument: ${a}`);
    }
    if (!args.dir) {
        throw new Error(
            "Missing --dir <deployDir> (the pnpm deploy output to prune).",
        );
    }
    args.platform = args.platform ?? process.platform;
    args.arch = args.arch ?? process.arch;
    return args;
}

// OS / arch tokens that can appear in a platform-specific package name.
const OS_TOKENS = ["win32", "windows", "linux", "darwin", "freebsd", "android"];
const ARCH_TOKENS = [
    "x64",
    "x86_64",
    "arm64",
    "aarch64",
    "arm",
    "ia32",
    "ppc64",
    "s390x",
    "riscv64",
];

function tokensIn(name, tokens) {
    const lower = name.toLowerCase();
    return tokens.filter((t) => {
        const tok = t.trim();
        // Match the token as a delimited segment (between -, _, /, start, end)
        const re = new RegExp(`(^|[-_/])${tok}([-_/]|$)`);
        return re.test(lower);
    });
}

/**
 * Decide whether a package directory is a foreign-platform native package that
 * should be removed for the given target.
 *
 * A per-RID native package always encodes an ARCH token (that is the whole
 * point of a prebuilt-binary variant: `...-win32-x64`, `...-win32-arm64`,
 * `@esbuild/linux-arm`, ...). We therefore require an arch token before
 * considering a directory for removal — this avoids false positives on agent
 * package names that merely contain an OS word (e.g. `android-mobile-agent`).
 *
 * Given an arch token, the package is foreign when its arch is not ours, or
 * when it also names an OS that is not ours (e.g. `linux-x64` on a win32-x64
 * target). Conservative by design: a package with no arch token is never
 * removed, so a server that boots before pruning still boots after.
 */
function isForeignPlatformPackage(name, platform, arch) {
    const archHits = tokensIn(name, ARCH_TOKENS);
    if (archHits.length === 0) {
        return false; // not an arch-specific native package
    }
    const osHits = tokensIn(name, OS_TOKENS);
    const archAliases = { x64: ["x64", "x86_64"], arm64: ["arm64", "aarch64"] };
    const targetArches = archAliases[arch] ?? [arch];
    const osAliases = { win32: ["win32", "windows"] };
    const targetOses = osAliases[platform] ?? [platform];

    // Arch is named and none of the named arches are ours -> foreign.
    if (!archHits.some((a) => targetArches.includes(a))) {
        return true;
    }
    // Arch matches, but an OS is named and it isn't ours -> foreign.
    if (osHits.length > 0 && !osHits.some((o) => targetOses.includes(o))) {
        return true;
    }
    return false;
}

function dirSizeBytes(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += dirSizeBytes(full);
        else if (entry.isFile()) {
            try {
                total += fs.statSync(full).size;
            } catch {
                // ignore unreadable entries
            }
        }
    }
    return total;
}

function fmt(bytes) {
    const mb = bytes / (1024 * 1024);
    return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function collectCandidates(nodeModulesDir) {
    const candidates = [];
    if (!fs.existsSync(nodeModulesDir)) return candidates;
    for (const entry of fs.readdirSync(nodeModulesDir, {
        withFileTypes: true,
    })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith("@")) {
            const scopeDir = path.join(nodeModulesDir, entry.name);
            for (const sub of fs.readdirSync(scopeDir, {
                withFileTypes: true,
            })) {
                if (sub.isDirectory()) {
                    candidates.push({
                        name: `${entry.name}/${sub.name}`,
                        full: path.join(scopeDir, sub.name),
                    });
                }
            }
        } else {
            candidates.push({
                name: entry.name,
                full: path.join(nodeModulesDir, entry.name),
            });
        }
    }
    return candidates;
}

function main() {
    const args = parseArgs(process.argv);
    const nodeModulesDir = path.join(args.dir, "node_modules");
    console.log(
        `Pruning foreign-platform packages from ${nodeModulesDir} (target ${args.platform}-${args.arch})${args.dryRun ? " [dry-run]" : ""}`,
    );

    const candidates = collectCandidates(nodeModulesDir);
    let freed = 0;
    const removed = [];
    for (const c of candidates) {
        if (isForeignPlatformPackage(c.name, args.platform, args.arch)) {
            const size = dirSizeBytes(c.full);
            freed += size;
            removed.push({ name: c.name, size });
            if (!args.dryRun) {
                fs.rmSync(c.full, { recursive: true, force: true });
            }
        }
    }

    removed.sort((a, b) => b.size - a.size);
    for (const r of removed) {
        console.log(
            `  ${args.dryRun ? "would remove" : "removed"}: ${r.name} (${fmt(r.size)})`,
        );
    }
    console.log(
        `${args.dryRun ? "Would free" : "Freed"} ${fmt(freed)} across ${removed.length} package(s).`,
    );
}

main();
