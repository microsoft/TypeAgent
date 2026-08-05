#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * setupWorktree - one command to make a fresh checkout (or git worktree) able
 * to install, build, and run.
 *
 * Two files the repo needs are gitignored (the repo is public, they hold
 * internal/secret data) so they are absent in every new worktree:
 *
 *   ts/.npmrc             points pnpm at the internal Azure Artifacts feed.
 *                         Must exist BEFORE `pnpm install`, or pnpm/corepack
 *                         reach the blocked public npm registry and install
 *                         fails. Provisioned by `getNPMRC` (Node built-ins
 *                         only, so it can run before install).
 *   ts/config.local.yaml  API keys. Provisioned by `getKeys`, which imports
 *                         installed packages (@azure/*, js-yaml, chalk) and so
 *                         must run AFTER `pnpm install`.
 *
 * Worktrees share a machine with the main checkout, so the fast, offline path
 * is to copy both files from the main checkout when they are already there.
 *
 * When a file cannot be copied, the fallback is the matching get* script:
 *
 *   .npmrc  -> `getNPMRC` only fetches an npm auth token for the internal feed
 *              (no secrets), so setup runs it automatically when the copy fails.
 *   config.local.yaml -> `getKeys` pulls API secrets from Key Vault and can open
 *              an interactive browser sign-in. That is a side effect the user
 *              must approve, so setup NEVER runs getKeys itself; it warns,
 *              prints the command, and continues (missing keys only block
 *              running the app, not install). The user (or agent, after asking)
 *              runs `pnpm run getKeys` manually when they choose to.
 *
 * This script runs before `pnpm install`, so it uses ONLY Node built-ins - no
 * imported packages (the same chicken-and-egg rule getNPMRC follows).
 *
 * Setup does NOT build. A full build of every package is redundant for most
 * sessions (fluid-build is incremental and dependency-aware, so build just the
 * package you touch, on demand: `pnpm run build <package>`). Pass `--build` to
 * warm a full build up front.
 *
 * Usage:
 *   pnpm run setup             # copy-provision and install (no build)
 *   pnpm run setup --build     # also run a full `pnpm run build` at the end
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This script lives at ts/tools/scripts/; the repo `ts/` dir is two up.
const repoTs = path.resolve(__dirname, "../..");

const args = new Set(process.argv.slice(2));
const doBuild = args.has("--build");
if (args.has("--help") || args.has("-h")) {
    console.log(
        "Usage: pnpm run setup [--build]\n" +
            "  Provisions ts/.npmrc and ts/config.local.yaml and installs.\n" +
            "  Files are copied from the main checkout when available. If .npmrc\n" +
            "  can't be copied, setup runs `pnpm run getNPMRC` (npm token only).\n" +
            "  If config.local.yaml can't be copied, setup does NOT run getKeys\n" +
            "  (it fetches secrets) - it prints the command to run yourself.\n" +
            "  --build      also run a full `pnpm run build` at the end\n" +
            "               (otherwise build the package you touch on demand).",
    );
    process.exit(0);
}

function log(step, message) {
    console.log(`[setup] ${step}: ${message}`);
}

// Run a command with inherited stdio so its output streams live. `cmd` is a
// shell command string (needed so `pnpm` resolves to pnpm.cmd on Windows).
function run(cmd) {
    log("run", cmd);
    execFileSync(cmd, {
        cwd: repoTs,
        stdio: "inherit",
        shell: true,
    });
}

// Compare two filesystem paths for equality, case-insensitively on Windows and
// macOS (whose default filesystems are case-insensitive, but path.resolve does
// not normalize case). Linux filesystems are case-sensitive.
function samePath(a, b) {
    const ra = path.resolve(a);
    const rb = path.resolve(b);
    const caseInsensitive =
        process.platform === "win32" || process.platform === "darwin";
    return caseInsensitive
        ? ra.toLowerCase() === rb.toLowerCase()
        : ra === rb;
}

// Locate the main checkout's `ts/` dir from any worktree via the shared git
// dir. `--git-common-dir` points at the main repo's `.git`, whose parent is
// the main working tree. Returns undefined for a plain (non-worktree) clone,
// or when git is unavailable.
function findMainCheckoutTs() {
    try {
        const commonDir = execFileSync(
            "git",
            ["rev-parse", "--path-format=absolute", "--git-common-dir"],
            { cwd: repoTs, encoding: "utf8" },
        ).trim();
        const mainTs = path.join(path.dirname(commonDir), "ts");
        // Same dir as this checkout means we ARE the main checkout: nothing to
        // copy from.
        if (samePath(mainTs, repoTs)) {
            return undefined;
        }
        return mainTs;
    } catch {
        return undefined;
    }
}

// Ensure `fileName` exists in this worktree's `ts/`. If missing, copy it from
// the main checkout when available. If it still can't be provided, the get*
// fallback runs only when `autoRun` is true (getNPMRC: npm token only, safe to
// run). When `autoRun` is false (getKeys: signs in to Azure and fetches
// secrets), setup never runs it - it just prints the command for the user to
// run. `required` files (needed before install) stop setup when unresolved;
// others warn and continue. Returns true when the file is now present.
function ensureProvisioned(fileName, fallbackScript, mainTs, { required, autoRun }) {
    const dest = path.join(repoTs, fileName);
    if (fs.existsSync(dest)) {
        log("ok", `${fileName} already present`);
        return true;
    }
    if (mainTs !== undefined) {
        const src = path.join(mainTs, fileName);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            log("copy", `${fileName} from main checkout (${src})`);
            return true;
        }
    }
    const cmd = `pnpm run ${fallbackScript}`;
    if (autoRun) {
        log("provision", `${fileName} missing; running \`${cmd}\``);
        run(cmd);
        if (fs.existsSync(dest)) {
            return true;
        }
        // Guard the "required" guarantee against a fallback that exits 0
        // without writing the file, rather than trusting its exit code alone.
        const failHint = `${fileName} is still missing after \`${cmd}\`. Provision it manually, then re-run setup.`;
        if (required) {
            log("blocked", failHint);
            process.exit(1);
        }
        log("skip", failHint);
        return false;
    }
    const hint =
        `${fileName} is missing and could not be copied from a main checkout.\n` +
        `        The \`${cmd}\` script signs in to Azure and fetches secrets, so\n` +
        `        setup does not run it. Run it yourself when ready (it will prompt\n` +
        `        an Azure sign-in, and may open a browser):\n` +
        `        \`${cmd}\``;
    if (required) {
        log("blocked", hint);
        process.exit(1);
    }
    log("skip", hint);
    return false;
}

const mainTs = findMainCheckoutTs();
if (mainTs !== undefined) {
    log("info", `main checkout detected at ${mainTs}`);
} else {
    log("info", "no separate main checkout; .npmrc will be provisioned via getNPMRC, config.local.yaml must be provisioned by running getKeys yourself");
}

// 1. .npmrc must exist before install so pnpm uses the internal feed. getNPMRC
//    only fetches an npm token (no secrets), so it's safe to run automatically.
ensureProvisioned(".npmrc", "getNPMRC", mainTs, { required: true, autoRun: true });

// 2. Install dependencies.
run("pnpm install");

// 3. config.local.yaml holds API secrets; getKeys can open an interactive Azure
//    sign-in, so setup never runs it automatically (autoRun: false).
ensureProvisioned("config.local.yaml", "getKeys", mainTs, { required: false, autoRun: false });

// 4. Build only when explicitly asked; otherwise leave building on demand.
if (doBuild) {
    run("pnpm run build");
    log("done", "setup complete; full build done, the checkout is ready");
} else {
    log(
        "done",
        "setup complete; build the package you need with `pnpm run build <package>` " +
            "(or `pnpm run setup --build` for a full build)",
    );
}
