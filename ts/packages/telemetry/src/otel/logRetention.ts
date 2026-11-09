// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Focused, dependency-injectable retention cleanup for the local JSONL
 * telemetry log directory.
 *
 * Scope
 * -----
 * This module is intentionally narrow. It ONLY manages TypeAgent's local
 * `.jsonl` telemetry logs — the files written by {@link JsonlLogExporter}.
 * It never touches subdirectories, non-`.jsonl` files, or the backend
 * OTLP/Loki/Tempo/Prometheus data that lives in the Grafana LGTM container.
 *
 * Contract
 * --------
 * 1. Enumerate the *log file's parent directory* (non-recursive) and pick
 *    only regular files whose name ends with `.jsonl`.
 * 2. Sum every such file (including the active log). This is the "total
 *    retained size" the operator's cap applies to.
 * 3. When the total is over the cap, delete inactive files oldest-first
 *    (mtime asc, path asc as a stable tie-break) until the total is at or
 *    below the cap.
 * 4. Never delete a file whose absolute path is claimed by a live
 *    {@link JsonlLogExporter} in this process, or that
 *    {@link RunLogRetentionCleanupOptions.isProtected} rejects.
 * 5. If the protected files alone exceed the cap, stop — report the
 *    remaining excess via `diagnostic` and return without deleting anything
 *    that is protected.
 * 6. Every filesystem error is reported through the injected `diagnostic`
 *    callback and never rejects the returned promise. Telemetry startup is
 *    not allowed to fail because retention could not run.
 *
 * Cross-process behaviour (best effort)
 * -------------------------------------
 * There is no cross-process lock. Retention protects live in-process
 * exporters via {@link RunLogRetentionCleanupOptions.isProtected}
 * (which callers typically back with `getActiveJsonlLogPaths()`) and
 * rechecks the predicate immediately before each `unlink` so a peer
 * exporter that opens between candidate selection and deletion is not
 * clobbered.
 *
 * For truly cross-process peers we rely on filesystem behaviour:
 *  - `ENOENT` on unlink means the file was already reclaimed — count it
 *    as freed and continue.
 *  - `EBUSY`, `EPERM`, or any other unlink failure is diagnosed and the
 *    candidate is skipped. On Windows this is the common case for files
 *    another process still has open; on POSIX unlink typically succeeds
 *    even when a peer holds the file open (the inode survives until the
 *    last fd closes).
 *  - Whatever remains above the cap after the loop is reported once via
 *    `diagnostic`; retention never rejects.
 *
 * A file that vanishes between `readdir` and `stat` (`ENOENT`) is
 * silently skipped — cooperative concurrency, not an error.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import type { Dirent, Stats } from "node:fs";
import { getJsonlLogPathIdentity } from "./jsonlLogExporter.js";

/**
 * Async filesystem surface used to enumerate and delete candidate data
 * files. Tests replace it to exercise stat/unlink races and Windows lock
 * failures.
 */
export interface LogRetentionFs {
    readdir(directory: string): Promise<readonly Dirent[]>;
    stat(filePath: string): Promise<Stats>;
    unlink(filePath: string): Promise<void>;
}

export interface RunLogRetentionCleanupOptions {
    /**
     * Absolute path of the live JSONL log file. The cleanup scans this
     * file's parent directory only.
     */
    readonly logFile: string;
    /**
     * Total-size cap in bytes. Values greater than zero enable cleanup.
     * `0` disables cleanup; negative values are rejected.
     */
    readonly retentionBytes: number;
    /**
     * Predicate that returns `true` for any absolute path that must not be
     * deleted (typically the active exporter file, plus any concurrent
     * exporter paths this process owns). The active log file is protected
     * unconditionally in addition to this predicate.
     *
     * The predicate is called TWICE per candidate: once to filter the
     * candidate list, and again immediately before `unlink` — the second
     * call catches a new exporter opening between snapshot and delete.
     */
    readonly isProtected?: (filePath: string) => boolean;
    /** Diagnostic callback for non-fatal errors. Never throws. */
    readonly diagnostic?: (message: string, error?: unknown) => void;
    /**
     * Injected filesystem. Defaults to `node:fs/promises`. Tests replace it
     * to exercise stat/unlink races and Windows lock failures.
     */
    readonly fs?: LogRetentionFs;
    /**
     * Injected `path` helpers. Defaults to `node:path`. Tests may point at
     * `path/posix` for cross-platform stability.
     */
    readonly path?: Pick<typeof nodePath, "dirname" | "resolve" | "basename">;
    /**
     * Whether file names should be compared case-insensitively. Defaults to
     * `true` on Windows and `false` elsewhere. Tests may override this to
     * exercise both filesystem semantics.
     */
    readonly caseInsensitiveFileNames?: boolean;
}

interface RetainedFile {
    readonly absolutePath: string;
    readonly size: number;
    readonly mtimeMs: number;
    readonly name: string;
}

const JSONL_SUFFIX = ".jsonl";

/**
 * Run the local JSONL retention cleanup exactly once. Resolves after all
 * planned deletions have been attempted. Never rejects: every failure is
 * routed through {@link RunLogRetentionCleanupOptions.diagnostic}.
 */
export async function runLogRetentionCleanup(
    options: RunLogRetentionCleanupOptions,
): Promise<void> {
    const fs = options.fs ?? defaultFs();
    const path = options.path ?? nodePath;
    const diagnostic = options.diagnostic ?? noopDiagnostic;
    const caseInsensitiveFileNames =
        options.caseInsensitiveFileNames ?? process.platform === "win32";
    const retentionBytes = options.retentionBytes;

    if (!Number.isFinite(retentionBytes) || retentionBytes < 0) {
        diagnostic(
            `JSONL log retention refused: invalid retentionBytes=${String(
                retentionBytes,
            )}.`,
        );
        return;
    }
    if (retentionBytes === 0) {
        // Explicitly disabled.
        return;
    }

    // Anchor everything against absolute paths so protection comparisons
    // are exact regardless of how the caller passed the log file in.
    const activePath = path.resolve(options.logFile);
    const directory = path.dirname(activePath);

    let entries: readonly Dirent[];
    try {
        entries = await fs.readdir(directory);
    } catch (error) {
        // A missing parent directory is expected the first time the
        // exporter opens; nothing to clean up yet.
        if (isFsErrorCode(error, "ENOENT")) {
            return;
        }
        diagnostic(
            `JSONL log retention could not enumerate "${directory}".`,
            error,
        );
        return;
    }

    // First pass: stat every .jsonl regular file. Skip anything that
    // vanishes (ENOENT) or fails to stat (report but continue). We never
    // recurse into subdirectories.
    const files: RetainedFile[] = [];
    for (const entry of entries) {
        if (!isJsonlEntry(entry, caseInsensitiveFileNames)) {
            continue;
        }
        const absolutePath = path.resolve(directory, entry.name);
        let stats: Stats;
        try {
            stats = await fs.stat(absolutePath);
        } catch (error) {
            if (isFsErrorCode(error, "ENOENT")) {
                continue;
            }
            diagnostic(
                `JSONL log retention could not stat "${absolutePath}".`,
                error,
            );
            continue;
        }
        if (!stats.isFile()) {
            continue;
        }
        files.push({
            absolutePath,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            name: entry.name,
        });
    }

    let totalBytes = 0;
    for (const file of files) {
        totalBytes += file.size;
    }
    if (totalBytes <= retentionBytes) {
        return;
    }

    // Snapshot the caller-supplied protection predicate once so subsequent
    // exporter openings do not race with the cleanup decisions we make.
    const isProtected = options.isProtected ?? ((_p: string): boolean => false);
    const activePathIdentity = normalizePathIdentity(
        activePath,
        caseInsensitiveFileNames,
    );
    const isActive = (candidate: string): boolean =>
        normalizePathIdentity(candidate, caseInsensitiveFileNames) ===
            activePathIdentity || isProtected(candidate);

    // Stable oldest-first ordering with a name tie-break so two files with
    // identical mtime are deleted in a deterministic order across runs.
    const candidates = files
        .filter((file) => !isActive(file.absolutePath))
        .sort((a, b) => {
            if (a.mtimeMs !== b.mtimeMs) {
                return a.mtimeMs - b.mtimeMs;
            }
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });

    let remaining = totalBytes;
    for (const candidate of candidates) {
        if (remaining <= retentionBytes) {
            break;
        }
        // Recheck protection immediately before unlink. A new exporter
        // may have opened AT this path since the candidate list was
        // built, and `isProtected` typically reads a live registry
        // (e.g. `getActiveJsonlLogPaths()`), so the recheck reflects
        // that.
        if (isProtected(candidate.absolutePath)) {
            continue;
        }
        try {
            await fs.unlink(candidate.absolutePath);
        } catch (error) {
            if (isFsErrorCode(error, "ENOENT")) {
                // Someone else already reclaimed the file. Count it as
                // freed so we do not over-report the excess.
                remaining -= candidate.size;
                continue;
            }
            // Everything else — EBUSY (Windows: peer holds an open
            // handle), EPERM (ACL or read-only volume), etc. — is a
            // best-effort skip. The remaining bytes stay in `remaining`
            // and are surfaced in the final diagnostic below.
            diagnostic(
                `JSONL log retention could not delete "${candidate.absolutePath}".`,
                error,
            );
            continue;
        }
        remaining -= candidate.size;
    }

    if (remaining > retentionBytes) {
        // Retention runs once per startup, so a single message is
        // enough. Include the actual retained bytes, the configured
        // limit, and the exact directory so the developer can act
        // without hunting for context. We deliberately do NOT say "disk
        // full" — the disk is fine; it is *our* log directory that has
        // outgrown the operator-configured cap.
        diagnostic(
            `Local telemetry log storage (${remaining} bytes) exceeds the ${retentionBytes}-byte limit and automatic cleanup could not free enough space. Stop TypeAgent processes or delete old .jsonl logs from ${directory}.`,
        );
    }
}

function isJsonlEntry(
    entry: Dirent,
    caseInsensitiveFileNames: boolean,
): boolean {
    if (!entry.isFile()) {
        return false;
    }
    const name = entry.name;
    if (name.length <= JSONL_SUFFIX.length) {
        return false;
    }
    const comparable = caseInsensitiveFileNames ? name.toLowerCase() : name;
    return comparable.endsWith(JSONL_SUFFIX);
}

function normalizePathIdentity(
    filePath: string,
    caseInsensitiveFileNames: boolean,
): string {
    return getJsonlLogPathIdentity(filePath, caseInsensitiveFileNames);
}

function isFsErrorCode(error: unknown, code: string): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === code
    );
}

function noopDiagnostic(): void {
    // Diagnostics are opt-in; retention cleanup is best-effort.
}

function defaultFs(): LogRetentionFs {
    return {
        // `fs.promises.readdir` with `withFileTypes: true` returns Dirents,
        // which lets us skip symlinks and subdirectories without a second
        // syscall per entry.
        readdir: (directory) =>
            nodeFs.readdir(directory, { withFileTypes: true }),
        stat: (filePath) => nodeFs.stat(filePath),
        unlink: (filePath) => nodeFs.unlink(filePath),
    };
}
