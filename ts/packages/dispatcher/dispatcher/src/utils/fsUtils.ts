// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import os from "node:os";

export function expandHome(pathname: string): string {
    if (!pathname.startsWith(`~${path.sep}`)) return pathname;
    return path.join(os.homedir(), pathname.substring(2));
}

export function getYMDPrefix() {
    const date = new Date();
    return `${date.getFullYear()}${(date.getMonth() + 1)
        .toString()
        .padStart(2, "0")}${date.getDate().toString().padStart(2, "0")}`;
}

export function getUniqueFileName(
    dirpath: string,
    prefix: string = "",
    ext: string = "",
) {
    let currentDirs = fs.existsSync(dirpath) ? fs.readdirSync(dirpath) : [];
    if (prefix !== "") {
        currentDirs = currentDirs.filter((d) => d.startsWith(prefix));
    }
    let dir = `${prefix}${ext}`;
    if (currentDirs.includes(dir)) {
        let index = 0;
        while (true) {
            dir = `${prefix}_${index}${ext}`;
            if (!currentDirs.includes(dir)) {
                return dir;
            }
            index++;
        }
    }
    return dir;
}

// Lock the instance (profile) directory so only one process (shell or
// agent-server) uses it at a time. proper-lockfile provides the atomic
// acquisition, an mtime "heartbeat", and stale-lock breaking; on top of it we
// add two things:
//   1. A human-readable owner marker so you can tell WHICH process holds the
//      lock (previously there was no way to know).
//   2. Recovery when the lock folder is deleted out from under a running
//      process: the heartbeat notices the lock is gone and recreates it so a
//      second process can't grab the same profile.
//
// Layout (for instanceDir = ".../profiles/dev"):
//   .../profiles/dev.lock/          <- the lock folder (what a user might delete)
//   .../profiles/dev.lock/held      <- proper-lockfile's tracked lock dir
//   .../profiles/dev.lock/pid-1234  <- owner marker (name = pid, body = details)
//
// proper-lockfile tracks the nested "held" dir, not the lock folder itself, so
// writing the marker into the folder does not bump the tracked mtime and cause
// a false "compromised" event. The pid can't go in the lock folder's own name:
// that name must be fixed for the atomic mkdir to provide mutual exclusion (a
// per-pid name would let every process create its own folder and never race).
export async function lockInstanceDir(instanceDir: string) {
    ensureDirectory(instanceDir);

    const lockFolder = `${instanceDir}.lock`;
    const heldPath = path.join(lockFolder, "held");
    const ownerMarkerName = `pid-${process.pid}`;

    let isExiting = false;
    // Named so the returned unlock can remove it: lockInstanceDir may run once
    // per conversation over a long-running server, and an anonymous per-call
    // listener would accumulate toward Node's max-listeners warning.
    const onProcessExit = () => {
        isExiting = true;
    };
    process.on("exit", onProcessExit);

    let release!: () => Promise<void>;

    // Drop a marker named after our pid (with host + start time in the body) so
    // `ls <instanceDir>.lock` reveals the owner. Also clear any marker left by a
    // crashed prior holder whose stale lock we just broke, keeping exactly one.
    const writeOwnerMarker = () => {
        try {
            for (const entry of fs.readdirSync(lockFolder)) {
                if (entry.startsWith("pid-") && entry !== ownerMarkerName) {
                    fs.rmSync(path.join(lockFolder, entry), { force: true });
                }
            }
            fs.writeFileSync(
                path.join(lockFolder, ownerMarkerName),
                `pid: ${process.pid}\nhost: ${os.hostname()}\nstarted: ${new Date().toISOString()}\ninstanceDir: ${instanceDir}\n`,
            );
        } catch {
            // Best effort: the marker is diagnostic only.
        }
    };

    // proper-lockfile mkdir's heldPath non-recursively, so the lock folder must
    // exist first.
    const acquire = () => {
        ensureDirectory(lockFolder);
        return lockfile.lock(instanceDir, {
            lockfilePath: heldPath,
            // Retry for up to ~30 seconds to handle the case where a previous
            // process was forcibly killed and its lock is not yet stale.
            retries: { retries: 30, minTimeout: 1000, maxTimeout: 1000 },
            // Break locks whose mtime heartbeat hasn't fired in 10s. proper-lockfile
            // updates the mtime every stale/2 ms (5s) while the holder is alive, so a
            // live server easily stays under the threshold. A crashed server's mtime
            // freezes and its orphaned lock gets broken here. stale must be < total
            // retry window (30s) so a freshly-orphaned lock can be recovered.
            stale: 10000,
            onCompromised,
        });
    };

    let recovering = false;
    const reacquire = async () => {
        if (isExiting || recovering) {
            return;
        }
        recovering = true;
        try {
            release = await acquire();
            writeOwnerMarker();
            console.error(
                `\nWARN: Instance directory lock ${lockFolder} was missing; recreated by pid ${process.pid}.\n`,
            );
        } catch (e) {
            console.error(
                `\nWARN: Failed to recreate instance directory lock ${lockFolder}: ${e}\n`,
            );
        } finally {
            recovering = false;
        }
    };

    function onCompromised(err: Error) {
        if (isExiting) {
            // We are exiting, just ignore the error
            return;
        }
        if (fs.existsSync(heldPath)) {
            // The lock is still present: either still ours (on Windows,
            // proper-lockfile's mtime check can spuriously fire for a live lock
            // when multiple processes are active) or another process legitimately
            // reclaimed our stale lock. Either way don't recreate it (that would
            // thrash or steal); log and continue, matching prior tolerant behavior.
            console.error(
                `\nWARN: User instance directory lock ${lockFolder} reported as compromised; continuing.\n  ${err}`,
            );
            return;
        }
        // The lock was removed out from under us (e.g. someone deleted the lock
        // folder while the server was running). Recreate it during this
        // heartbeat so a second process can't grab the profile.
        void reacquire();
    }

    try {
        release = await acquire();
    } catch (e: any) {
        if (e?.code === "ELOCKED") {
            const err: any = new Error(
                `Another agent-server (or shell) is already using the instance directory:\n  ${instanceDir}\n\nOnly one process can hold this directory at a time. Stop the other instance and try again, or set TYPEAGENT_USER_DATA_DIR to use a separate profile.`,
            );
            err.code = "ERR_INSTANCE_LOCKED";
            err.instanceDir = instanceDir;
            throw err;
        }
        throw new Error(
            `Unable to lock instance directory ${instanceDir}. Only one client per instance directory can be active at a time. Cause: ${e?.code ?? "unknown"} (${e?.message ?? e})`,
        );
    }

    writeOwnerMarker();

    // Returned unlock: release proper-lockfile's hold, then tear down the lock
    // folder we created. All best effort.
    return async () => {
        isExiting = true;
        process.removeListener("exit", onProcessExit);
        let released = false;
        try {
            await release();
            released = true;
        } catch {
            // Already released or compromised: nothing to unlock.
        }
        if (released) {
            // We released our own hold (proper-lockfile removed "held"), so the
            // folder is ours to remove. Recursive + force so the pid marker (and
            // the "held" dir, and any stray entry) go with it rather than
            // leaking a non-empty directory.
            try {
                fs.rmSync(lockFolder, { recursive: true, force: true });
            } catch {
                // Best effort.
            }
        } else {
            // Release failed: another process may have reclaimed "held" after we
            // were compromised. Only drop our own marker; don't recursively
            // delete a lock folder we may no longer own.
            try {
                fs.rmSync(path.join(lockFolder, ownerMarkerName), {
                    force: true,
                });
            } catch {
                // Best effort.
            }
        }
    };
}
export function ensureCacheDir(instanceDir: string) {
    const dir = path.join(instanceDir, "cache");
    ensureDirectory(dir);
    return dir;
}

export function ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (error: any) {
            if (fs.existsSync(dir)) {
                // there might be a race
                return;
            }
            throw new Error(
                `Error creating directory '${dir}': ${error.message}`,
            );
        }
    }
}

// Read + JSON.parse a file, degrading to `undefined` (never throwing) when the
// path is unset, missing, unreadable, or malformed. `onError` receives read /
// parse failures for optional debug logging; a missing file is silent. The
// caller owns shape validation and the default value, so the same primitive
// serves every profile-scoped JSON store (preferences, keyword sidecar,
// neighborhood registry, ...).
export function readJsonFileSafe(
    filePath: string | undefined,
    onError?: (error: unknown) => void,
): unknown {
    if (filePath === undefined || !fs.existsSync(filePath)) {
        return undefined;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        onError?.(error);
        return undefined;
    }
}

// Serialize `data` as pretty JSON and write it, creating parent directories as
// needed. Swallows all I/O errors (routed to `onError` for optional debug
// logging) so a filesystem hiccup never crashes the caller — matching the
// best-effort persistence the profile-scoped stores rely on.
export function writeJsonFileSafe(
    filePath: string,
    data: unknown,
    onError?: (error: unknown) => void,
): void {
    try {
        ensureDirectory(path.dirname(filePath));
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    } catch (error) {
        onError?.(error);
    }
}
