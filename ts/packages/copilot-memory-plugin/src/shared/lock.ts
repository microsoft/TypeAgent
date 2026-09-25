// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import lockfile from "proper-lockfile";

const LOCK_WAIT_MS = 120_000;
const LOCK_STALE_MS = 10_000;
const LOCK_POLL_MS = 500;

function isErrno(error: unknown, code: string): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === code
    );
}

/**
 * Exclusive lock so hook and MCP processes do not interleave JSON saves.
 * Uses proper-lockfile like the instance directory lock: acquisition is an
 * atomic mkdir, a live holder keeps the lock fresh through an mtime
 * heartbeat, and a dead holder's lock is broken only after it stays stale.
 * Release removes only the lock this process acquired, so a waiter can
 * never delete another owner's lock the way a manual unlink could.
 *
 * If the lock is compromised (another process took it), `signal` aborts so
 * `fn` can stop persisting, and the call rejects instead of returning.
 */
export async function withMemoryLock<T>(
    dirPath: string,
    fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    await fs.mkdir(dirPath, { recursive: true });
    const lost = new AbortController();
    let release: () => Promise<void>;
    try {
        release = await lockfile.lock(dirPath, {
            stale: LOCK_STALE_MS,
            retries: {
                retries: Math.ceil(LOCK_WAIT_MS / LOCK_POLL_MS),
                minTimeout: LOCK_POLL_MS,
                maxTimeout: LOCK_POLL_MS,
                factor: 1,
            },
            onCompromised: (error) => {
                process.stderr.write(
                    `[typeagent-memory] Memory lock at ${dirPath}.lock compromised: ${error}\n`,
                );
                lost.abort(error);
            },
        });
    } catch (error) {
        if (isErrno(error, "ELOCKED")) {
            throw new Error(
                `Timed out waiting for memory lock at ${dirPath}.lock`,
            );
        }
        throw error;
    }
    try {
        const result = await fn(lost.signal);
        // Fail-stop: a result produced without the lock must not be reported as success.
        lost.signal.throwIfAborted();
        return result;
    } finally {
        await release().catch(() => undefined);
    }
}
