// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import {
    mkdir,
    open,
    readFile,
    rename,
    rm,
    stat,
    type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import registerDebug from "debug";

const LockPollIntervalMs = 250;
const InvalidLockStaleMs = 60_000;
const debug = registerDebug("typeagent:aiclient:localEmbedding");

type LockOwner = {
    pid: number;
};

function getLockPath(cacheDir: string, modelName: string): string {
    const key = createHash("sha256").update(modelName).digest("hex");
    return path.join(cacheDir, ".typeagent-locks", `${key}.lock`);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
    );
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return !isErrnoException(error) || error.code !== "ESRCH";
    }
}

async function isAbandonedLock(lockPath: string): Promise<boolean> {
    try {
        const owner = JSON.parse(await readFile(lockPath, "utf8")) as LockOwner;
        if (Number.isInteger(owner.pid) && owner.pid > 0) {
            return !isProcessRunning(owner.pid);
        }
    } catch (error) {
        if (isErrnoException(error) && error.code === "ENOENT") {
            return true;
        }
    }

    try {
        const lockStat = await stat(lockPath);
        return Date.now() - lockStat.mtimeMs > InvalidLockStaleMs;
    } catch (error) {
        return isErrnoException(error) && error.code === "ENOENT";
    }
}

async function reclaimAbandonedLock(lockPath: string): Promise<boolean> {
    if (!(await isAbandonedLock(lockPath))) {
        return false;
    }

    const abandonedPath = `${lockPath}.abandoned-${randomUUID()}`;
    try {
        await rename(lockPath, abandonedPath);
    } catch (error) {
        if (
            isErrnoException(error) &&
            (error.code === "ENOENT" ||
                error.code === "EACCES" ||
                error.code === "EPERM")
        ) {
            return false;
        }
        throw error;
    }

    await rm(abandonedPath, { force: true });
    debug(`Reclaimed abandoned local embedding cache lock '${lockPath}'`);
    return true;
}

async function acquireLock(lockPath: string): Promise<FileHandle> {
    await mkdir(path.dirname(lockPath), { recursive: true });
    let reportedWait = false;

    while (true) {
        try {
            const handle = await open(lockPath, "wx");
            try {
                await handle.writeFile(JSON.stringify({ pid: process.pid }));
                return handle;
            } catch (error) {
                await handle.close();
                await rm(lockPath, { force: true });
                throw error;
            }
        } catch (error) {
            if (!isErrnoException(error) || error.code !== "EEXIST") {
                throw error;
            }
            if (!reportedWait) {
                debug(`Waiting for local embedding cache lock '${lockPath}'`);
                reportedWait = true;
            }
        }

        if (await reclaimAbandonedLock(lockPath)) {
            continue;
        }

        await new Promise((resolve) => setTimeout(resolve, LockPollIntervalMs));
    }
}

export async function runWithLocalEmbeddingModelLock<T>(
    cacheDir: string,
    modelName: string,
    operation: () => Promise<T>,
): Promise<T> {
    const lockPath = getLockPath(cacheDir, modelName);
    const handle = await acquireLock(lockPath);
    try {
        return await operation();
    } finally {
        await handle.close();
        await rm(lockPath, { force: true });
    }
}
