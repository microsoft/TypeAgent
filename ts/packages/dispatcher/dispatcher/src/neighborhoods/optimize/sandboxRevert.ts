// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Sandbox snapshot + per-attempt revert. The optimize loop edits files in
// `<workdir>/sandbox/agents/<schemaName>/` and reverts between attempts by
// copying back from `<workdir>/sandbox/.original/agents/<schemaName>/`. File
// I/O is cheap relative to LLM cost; reverts are just `fs.copyFile`.
//
// The snapshot is taken once at the start of a run; every per-attempt
// revert reads from it. The wrapper is intentionally tiny so the hot path
// is obvious.

import * as fs from "node:fs";
import * as path from "node:path";

import { ensureDir } from "./util.js";

const ORIGINAL_SUBDIR = ".original";
const AGENTS_SUBDIR = "agents";

/** Build the `.original/` subtree from the current state of
 *  `sandbox/agents/`. Idempotent: re-snapshotting overwrites the existing
 *  `.original/` so an interrupted run can be re-initialized safely. */
export function snapshotSandboxOriginal(sandboxDir: string): void {
    const agentsDir = path.join(sandboxDir, AGENTS_SUBDIR);
    const originalDir = path.join(sandboxDir, ORIGINAL_SUBDIR, AGENTS_SUBDIR);
    if (!fs.existsSync(agentsDir)) {
        throw new Error(
            `snapshotSandboxOriginal: ${agentsDir} does not exist. Build the sandbox before snapshotting.`,
        );
    }
    fs.rmSync(originalDir, { recursive: true, force: true });
    copyDirRecursive(agentsDir, originalDir);
}

/** Revert one schema's sandbox files to the `.original/` snapshot. Used
 *  per-attempt: the lever wrote some patched files; revert restores the
 *  state before the next attempt. */
export function revertSandboxFromOriginal(
    schemaName: string,
    sandboxDir: string,
): void {
    const originalSchemaDir = path.join(
        sandboxDir,
        ORIGINAL_SUBDIR,
        AGENTS_SUBDIR,
        schemaName,
    );
    const liveSchemaDir = path.join(sandboxDir, AGENTS_SUBDIR, schemaName);
    if (!fs.existsSync(originalSchemaDir)) {
        throw new Error(
            `revertSandboxFromOriginal: no snapshot at ${originalSchemaDir}. Did snapshotSandboxOriginal run?`,
        );
    }
    // Remove current contents wholesale; copy back from snapshot.
    fs.rmSync(liveSchemaDir, { recursive: true, force: true });
    copyDirRecursive(originalSchemaDir, liveSchemaDir);
}

/** Revert ALL schemas to snapshot. Used after a case completes so the
 *  sandbox is clean before the next case starts. */
export function revertAllFromOriginal(sandboxDir: string): void {
    const originalAgentsDir = path.join(
        sandboxDir,
        ORIGINAL_SUBDIR,
        AGENTS_SUBDIR,
    );
    const liveAgentsDir = path.join(sandboxDir, AGENTS_SUBDIR);
    if (!fs.existsSync(originalAgentsDir)) {
        throw new Error(
            `revertAllFromOriginal: no snapshot at ${originalAgentsDir}.`,
        );
    }
    fs.rmSync(liveAgentsDir, { recursive: true, force: true });
    copyDirRecursive(originalAgentsDir, liveAgentsDir);
}

function copyDirRecursive(srcDir: string, destDir: string): void {
    ensureDir(destDir);
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const src = path.join(srcDir, entry.name);
        const dest = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(src, dest);
        } else if (entry.isFile()) {
            fs.copyFileSync(src, dest);
        }
        // Skip symlinks / other special files — sandbox contains only
        // regular files (schema.ts, schema.pas.json, manifest.json, etc.).
    }
}
