// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { StudioWorkspaceState } from "@typeagent/core/runtime";

/**
 * Durable, file-backed {@link StudioWorkspaceState} for the standalone Studio
 * service's per-workspace runtime — so sandboxes (and other persisted runtime
 * state) survive service restarts (it used to be ephemeral
 * `MemoryWorkspaceState`).
 *
 * `get` is synchronous (the runtime reads at construction/restore time), so the
 * whole store is loaded into memory once on construction and served from there;
 * `update` writes the snapshot back atomically (temp + rename) and serializes
 * writes so concurrent mutations can't interleave a half-written file.
 */
export class FileWorkspaceState implements StudioWorkspaceState {
    private readonly store: Record<string, unknown>;
    private writeChain: Promise<void> = Promise.resolve();

    constructor(private readonly file: string) {
        this.store = loadSnapshot(file);
    }

    get<T>(key: string): T | undefined {
        return this.store[key] as T | undefined;
    }

    update(key: string, value: unknown): Promise<void> {
        this.store[key] = value;
        const snapshot = JSON.stringify(this.store);
        // Serialize writes; a failed write is swallowed so a transient disk
        // error can't reject a runtime mutation (the in-memory store stays
        // authoritative for this session).
        this.writeChain = this.writeChain
            .catch(() => {})
            .then(() => writeSnapshot(this.file, snapshot));
        return this.writeChain;
    }
}

/** Per-repo-root workspace-state file path under the Studio profile dir. */
export function studioWorkspaceStateFile(dir: string, repoKey: string): string {
    const hash = createHash("sha256")
        .update(repoKey)
        .digest("hex")
        .slice(0, 16);
    return path.join(dir, `workspace-${hash}.json`);
}

function loadSnapshot(file: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        return parsed !== null && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {}; // missing or malformed — start empty
    }
}

function writeSnapshot(file: string, snapshot: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, snapshot);
    renameSync(tmp, file);
}
