// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import path from "node:path";

const LOCK_WAIT_MS = 120_000;
const LOCK_POLL_MS = 50;

function isErrno(error: unknown, code: string): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === code
    );
}

async function lockHolderDead(lockPath: string): Promise<boolean> {
    let raw: string;
    try {
        raw = await fs.readFile(lockPath, "utf8");
    } catch (error) {
        return isErrno(error, "ENOENT");
    }
    const pid = Number(raw.trim());
    if (!Number.isInteger(pid) || pid <= 0) {
        return true;
    }
    try {
        process.kill(pid, 0);
        return false;
    } catch (error) {
        return !isErrno(error, "EPERM");
    }
}

async function tryAcquire(lockPath: string): Promise<boolean> {
    try {
        const handle = await fs.open(lockPath, "wx");
        try {
            await handle.writeFile(String(process.pid));
        } finally {
            await handle.close();
        }
        return true;
    } catch (error) {
        if (!isErrno(error, "EEXIST")) {
            throw error;
        }
        return false;
    }
}

/**
 * Exclusive lock so hook and MCP processes do not interleave JSON saves.
 * A lock whose owning pid is gone is stolen.
 */
export async function withMemoryLock<T>(
    dirPath: string,
    fn: () => Promise<T>,
): Promise<T> {
    await fs.mkdir(dirPath, { recursive: true });
    const lockPath = path.join(dirPath, ".lock");
    const started = Date.now();
    while (!(await tryAcquire(lockPath))) {
        if (await lockHolderDead(lockPath)) {
            await fs.unlink(lockPath).catch((error: unknown) => {
                if (!isErrno(error, "ENOENT")) {
                    throw error;
                }
            });
            continue;
        }
        if (Date.now() - started > LOCK_WAIT_MS) {
            throw new Error(`Timed out waiting for memory lock at ${lockPath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
    try {
        return await fn();
    } finally {
        await fs.unlink(lockPath).catch(() => undefined);
    }
}
