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
            onCompromised: (err) => {
                if (isExiting) {
                    // We are exiting, just ignore the error
                    return;
                }
                console.error(
                    `\nERROR: User instance directory lock ${instanceDir} compromised. Only one client per instance directory can be active at a time.\n  ${err}`,
                );
                process.exit(-1);
            },
        });
    } catch (e) {
        throw new Error(
            `Unable to lock instance directory ${instanceDir}. Only one client per instance directory can be active at a time.`,
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
