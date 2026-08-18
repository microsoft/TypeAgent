// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Dirent, Stats } from "node:fs";
import * as nodePath from "node:path";
import * as posix from "node:path/posix";
import { getJsonlLogPathIdentity } from "../src/otel/jsonlLogExporter.js";
import {
    runLogRetentionCleanup,
    type LogRetentionFs,
} from "../src/otel/logRetention.js";

/** Async in-memory fs fake for the data-file layer. */
interface FakeFile {
    size: number;
    mtimeMs: number;
    isFile: boolean;
    unlinkError?: NodeJS.ErrnoException;
    statError?: NodeJS.ErrnoException;
}

function makeFs(
    directory: string,
    layout: Record<string, FakeFile>,
    options: { readdirError?: NodeJS.ErrnoException } = {},
): { fs: LogRetentionFs; unlinked: string[] } {
    const unlinked: string[] = [];
    const files = new Map(Object.entries(layout));
    const fs: LogRetentionFs = {
        async readdir(dir: string): Promise<readonly Dirent[]> {
            if (options.readdirError !== undefined) {
                throw options.readdirError;
            }
            if (dir !== directory) {
                const err: NodeJS.ErrnoException = new Error("ENOENT");
                err.code = "ENOENT";
                throw err;
            }
            return [...files.keys()].map((name) => {
                const file = files.get(name)!;
                return {
                    name,
                    isFile: () => file.isFile,
                    isDirectory: () => !file.isFile,
                    isBlockDevice: () => false,
                    isCharacterDevice: () => false,
                    isSymbolicLink: () => false,
                    isFIFO: () => false,
                    isSocket: () => false,
                } as unknown as Dirent;
            });
        },
        async stat(filePath: string): Promise<Stats> {
            const name = posix.basename(filePath);
            const file = files.get(name);
            if (file === undefined) {
                const err: NodeJS.ErrnoException = new Error("ENOENT");
                err.code = "ENOENT";
                throw err;
            }
            if (file.statError !== undefined) {
                throw file.statError;
            }
            return {
                size: file.size,
                mtimeMs: file.mtimeMs,
                isFile: () => file.isFile,
                isDirectory: () => !file.isFile,
            } as unknown as Stats;
        },
        async unlink(filePath: string): Promise<void> {
            const name = posix.basename(filePath);
            const file = files.get(name);
            if (file === undefined) {
                const err: NodeJS.ErrnoException = new Error("ENOENT");
                err.code = "ENOENT";
                throw err;
            }
            if (file.unlinkError !== undefined) {
                throw file.unlinkError;
            }
            unlinked.push(name);
            files.delete(name);
        },
    };
    return { fs, unlinked };
}

function fsError(code: string): NodeJS.ErrnoException {
    const err: NodeJS.ErrnoException = new Error(code);
    err.code = code;
    return err;
}

const dir = "/logs";
const active = `${dir}/agent-server-active.jsonl`;

/** Runner that fixes the shared invariants for every case. */
async function run(
    fs: LogRetentionFs,
    partial: Partial<Parameters<typeof runLogRetentionCleanup>[0]> = {},
): Promise<void> {
    await runLogRetentionCleanup({
        logFile: active,
        retentionBytes: 60,
        fs,
        path: posix,
        ...partial,
    });
}

describe("runLogRetentionCleanup — cap enforcement", () => {
    it("is a no-op when retentionBytes is 0 (cleanup disabled)", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "a.jsonl": { size: 999, mtimeMs: 1, isFile: true },
        });
        await run(fs, { retentionBytes: 0 });
        expect(unlinked).toEqual([]);
    });

    it("is a no-op when total size is at or below the cap", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "a.jsonl": { size: 50, mtimeMs: 1, isFile: true },
            "b.jsonl": { size: 50, mtimeMs: 2, isFile: true },
        });
        await run(fs, { retentionBytes: 100 });
        expect(unlinked).toEqual([]);
    });

    it("deletes oldest inactive .jsonl files first until under the cap", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "old.jsonl": { size: 60, mtimeMs: 10, isFile: true },
            "mid.jsonl": { size: 40, mtimeMs: 20, isFile: true },
            "new.jsonl": { size: 30, mtimeMs: 30, isFile: true },
        });
        await run(fs, { retentionBytes: 60 });
        expect(unlinked).toEqual(["old.jsonl", "mid.jsonl"]);
    });

    it("uses name as a stable tie-breaker when mtimes match", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "b.jsonl": { size: 50, mtimeMs: 100, isFile: true },
            "a.jsonl": { size: 50, mtimeMs: 100, isFile: true },
            "c.jsonl": { size: 50, mtimeMs: 100, isFile: true },
        });
        await run(fs);
        expect(unlinked).toEqual(["a.jsonl", "b.jsonl"]);
    });

    it("never deletes the active log file", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "agent-server-active.jsonl": {
                size: 200,
                mtimeMs: 1,
                isFile: true,
            },
            "old.jsonl": { size: 60, mtimeMs: 2, isFile: true },
        });
        const messages: string[] = [];
        await run(fs, {
            retentionBytes: 100,
            diagnostic: (m) => messages.push(m),
        });
        expect(unlinked).toEqual(["old.jsonl"]);
        // Exactly one actionable diagnostic on excess. Assert every
        // meaningful field: retained bytes, configured limit, the
        // directory to look in, and the developer-facing action. Also
        // assert we do NOT claim the disk itself is full.
        expect(messages).toHaveLength(1);
        const message = messages[0];
        expect(message).toContain("Local telemetry log storage");
        expect(message).toContain("(200 bytes)");
        expect(message).toContain("100-byte limit");
        expect(message).toContain(
            "Stop TypeAgent processes or delete old .jsonl logs from",
        );
        expect(message).toContain(dir);
        expect(message).not.toMatch(/disk (is )?full/i);
    });

    it("respects the isProtected predicate for concurrent exporter paths", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "agent-server-active.jsonl": { size: 10, mtimeMs: 1, isFile: true },
            "peer.jsonl": { size: 60, mtimeMs: 2, isFile: true },
            "old.jsonl": { size: 60, mtimeMs: 3, isFile: true },
        });
        await run(fs, {
            retentionBytes: 70,
            isProtected: (p) => p === `${dir}/peer.jsonl`,
        });
        expect(unlinked).toEqual(["old.jsonl"]);
    });

    it("ignores non-jsonl files and directories", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "notes.txt": { size: 500, mtimeMs: 1, isFile: true },
            subdir: { size: 0, mtimeMs: 1, isFile: false },
            "old.jsonl": { size: 60, mtimeMs: 2, isFile: true },
            "new.jsonl": { size: 40, mtimeMs: 3, isFile: true },
        });
        await run(fs, { retentionBytes: 50 });
        expect(unlinked).toEqual(["old.jsonl"]);
    });

    it("does not manage uppercase .JSONL files on case-sensitive filesystems", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "unrelated.JSONL": { size: 500, mtimeMs: 1, isFile: true },
            "old.jsonl": { size: 60, mtimeMs: 2, isFile: true },
        });
        await run(fs, {
            retentionBytes: 10,
            caseInsensitiveFileNames: false,
        });
        expect(unlinked).toEqual(["old.jsonl"]);
    });

    it("protects the active path using case-insensitive Windows identity", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "AGENT-SERVER-ACTIVE.JSONL": {
                size: 100,
                mtimeMs: 1,
                isFile: true,
            },
            "old.jsonl": { size: 60, mtimeMs: 2, isFile: true },
        });
        await run(fs, {
            retentionBytes: 50,
            caseInsensitiveFileNames: true,
        });
        expect(unlinked).toEqual(["old.jsonl"]);
    });

    it("manages uppercase .JSONL files on case-insensitive filesystems", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "old.JSONL": { size: 60, mtimeMs: 1, isFile: true },
        });
        await run(fs, {
            retentionBytes: 10,
            caseInsensitiveFileNames: true,
        });
        expect(unlinked).toEqual(["old.JSONL"]);
    });

    it("normalizes JSONL ownership identity before Windows case folding", () => {
        const relative = nodePath.join("logs", "ACTIVE.JSONL");
        const absolute = nodePath.resolve("logs", "active.jsonl");
        expect(getJsonlLogPathIdentity(relative, true)).toBe(
            getJsonlLogPathIdentity(absolute, true),
        );
    });
});

describe("runLogRetentionCleanup — error paths", () => {
    it("treats a missing directory as 'nothing to do'", async () => {
        const { fs, unlinked } = makeFs(
            dir,
            {},
            { readdirError: fsError("ENOENT") },
        );
        const messages: string[] = [];
        await run(fs, {
            retentionBytes: 100,
            diagnostic: (m) => messages.push(m),
        });
        expect(unlinked).toEqual([]);
        expect(messages).toEqual([]);
    });

    it("reports non-ENOENT readdir errors and does not delete anything", async () => {
        const { fs, unlinked } = makeFs(
            dir,
            {},
            { readdirError: fsError("EACCES") },
        );
        const messages: string[] = [];
        await run(fs, {
            retentionBytes: 100,
            diagnostic: (m) => messages.push(m),
        });
        expect(unlinked).toEqual([]);
        expect(messages.some((m) => /could not enumerate/.test(m))).toBe(true);
    });

    it("continues after a non-fatal unlink failure (Windows lock)", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "locked.jsonl": {
                size: 60,
                mtimeMs: 1,
                isFile: true,
                unlinkError: fsError("EBUSY"),
            },
            "old.jsonl": { size: 60, mtimeMs: 2, isFile: true },
        });
        const messages: string[] = [];
        await run(fs, {
            retentionBytes: 60,
            diagnostic: (m) => messages.push(m),
        });
        expect(unlinked).toEqual(["old.jsonl"]);
        expect(messages.some((m) => /could not delete/.test(m))).toBe(true);
    });

    it("treats an unlink ENOENT as reclaimed and does not diagnose", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "gone.jsonl": {
                size: 60,
                mtimeMs: 1,
                isFile: true,
                unlinkError: fsError("ENOENT"),
            },
            "old.jsonl": { size: 60, mtimeMs: 2, isFile: true },
        });
        const messages: string[] = [];
        await run(fs, {
            retentionBytes: 30,
            diagnostic: (m) => messages.push(m),
        });
        // gone.jsonl vanished before we could unlink; count it as freed
        // so old.jsonl only needs to close the remaining excess.
        expect(unlinked).toEqual(["old.jsonl"]);
        expect(messages).toEqual([]);
    });

    it("treats a stat ENOENT race as a silently-skipped file", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "vanished.jsonl": {
                size: 999,
                mtimeMs: 1,
                isFile: true,
                statError: fsError("ENOENT"),
            },
            "old.jsonl": { size: 60, mtimeMs: 2, isFile: true },
        });
        const messages: string[] = [];
        await run(fs, {
            retentionBytes: 30,
            diagnostic: (m) => messages.push(m),
        });
        expect(unlinked).toEqual(["old.jsonl"]);
        expect(messages).toEqual([]);
    });

    it("rejects a negative retentionBytes via diagnostic and returns", async () => {
        const { fs, unlinked } = makeFs(dir, {
            "a.jsonl": { size: 500, mtimeMs: 1, isFile: true },
        });
        const messages: string[] = [];
        await run(fs, {
            retentionBytes: -1,
            diagnostic: (m) => messages.push(m),
        });
        expect(unlinked).toEqual([]);
        expect(messages.some((m) => /invalid retentionBytes/.test(m))).toBe(
            true,
        );
    });
});

describe("runLogRetentionCleanup — isProtected recheck", () => {
    it("skips a candidate whose isProtected flips true after selection", async () => {
        // A peer exporter opens between candidate list construction
        // and the immediate-pre-unlink recheck. Guard: the second
        // predicate call skips the unlink.
        const { fs, unlinked } = makeFs(dir, {
            "target.jsonl": { size: 60, mtimeMs: 1, isFile: true },
            "old.jsonl": { size: 60, mtimeMs: 2, isFile: true },
        });
        let peerLive = false;
        const messages: string[] = [];
        await run(fs, {
            retentionBytes: 60,
            // First call (filter) uses the initial predicate. The second
            // call (immediately before unlink) sees peerLive flipped to
            // true and refuses to delete target.jsonl.
            isProtected: (p) => {
                if (p === `${dir}/target.jsonl`) {
                    const wasLive = peerLive;
                    peerLive = true;
                    return wasLive;
                }
                return false;
            },
            diagnostic: (m) => messages.push(m),
        });
        expect(unlinked).toEqual(["old.jsonl"]);
        // target.jsonl remains, so we cannot get under the cap and the
        // once-per-startup actionable diagnostic fires.
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("60-byte limit");
        expect(messages[0]).toContain(dir);
    });
});
