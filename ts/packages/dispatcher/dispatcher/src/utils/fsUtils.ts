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

export async function lockInstanceDir(instanceDir: string) {
    ensureDirectory(instanceDir);
    try {
        let isExiting = false;
        process.on("exit", () => {
            isExiting = true;
        });
        return await lockfile.lock(instanceDir, {
            // Retry for up to ~15 seconds to handle the case where a previous
            // process was forcibly killed and its lock file is not yet stale.
            retries: { retries: 30, minTimeout: 1000, maxTimeout: 1000 },
            // Break locks whose mtime heartbeat hasn't fired in 10s. proper-lockfile
            // updates the mtime every stale/2 ms (5s) while the holder is alive, so a
            // live server easily stays under the threshold. A crashed server's mtime
            // freezes and its orphaned lock gets broken here. stale must be < total
            // retry window (30s) so a freshly-orphaned lock can be recovered.
            stale: 10000,
            onCompromised: (err) => {
                if (isExiting) {
                    // We are exiting, just ignore the error
                    return;
                }
                // Log but do not exit — on Windows, proper-lockfile's PID liveness
                // check can incorrectly mark a live lock as stale, causing false
                // compromised events when running multiple concurrent server processes.
                console.error(
                    `\nWARN: User instance directory lock ${instanceDir} reported as compromised — continuing.\n  ${err}`,
                );
            },
        });
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
            `Unable to lock instance directory ${instanceDir}. Only one client per instance directory can be active at a time. Cause: ${e?.code ?? "unknown"} — ${e?.message ?? e}`,
        );
    }
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
