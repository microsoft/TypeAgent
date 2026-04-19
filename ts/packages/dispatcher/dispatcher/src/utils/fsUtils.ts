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
