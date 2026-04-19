// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result } from "typechat";
import registerDebug from "debug";

const debugRetry = registerDebug("typeagent:async:retry");

/**
 * Call an async function with automatic retry in the case of exceptions.
 * Each attempt can optionally be bounded by a per-attempt timeout; without
 * this, a hung network call would never unblock the retry loop.
 * @param asyncFn Use closures to pass parameters
 * @param retryMaxAttempts maximum retry attempts. Default is 2
 * @param retryPauseMs Pause between attempts. Default is 1000 ms. Uses exponential backoff
 * @param shouldAbort (Optional) Inspect the error and abort
 * @param timeoutMs (Optional) Per-attempt timeout in ms. 0/undefined = no timeout.
 * @returns Result<T>
 */
export async function callWithRetry<T = any>(
    asyncFn: () => Promise<T>,
    retryMaxAttempts: number = 2,
    retryPauseMs: number = 1000,
    shouldAbort?: (error: any) => boolean | undefined,
    timeoutMs?: number,
): Promise<T> {
    let retryCount = 0;
    while (true) {
        const attemptStart = Date.now();
        try {
            if (timeoutMs && timeoutMs > 0) {
                return await withTimeout(asyncFn(), timeoutMs);
            }
            return await asyncFn();
        } catch (e: any) {
            const elapsed = Date.now() - attemptStart;
            const msg =
                e?.message ??
                (typeof e === "string" ? e : JSON.stringify(e));
            if (
                retryCount >= retryMaxAttempts ||
                (shouldAbort && shouldAbort(e))
            ) {
                debugRetry(
                    `giving up after attempt ${retryCount + 1}/${
                        retryMaxAttempts + 1
                    } (${elapsed}ms): ${msg}`,
                );
                throw e;
            }
            debugRetry(
                `attempt ${retryCount + 1}/${
                    retryMaxAttempts + 1
                } failed (${elapsed}ms), retrying in ${retryPauseMs}ms: ${msg}`,
            );
        }
        await pause(retryPauseMs);
        retryCount++;
        retryPauseMs *= 2; // Use exponential backoff for retries
    }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race<T>([
            p,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(`callWithRetry attempt timed out after ${ms}ms`),
                        ),
                    ms,
                );
            }),
        ]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

/**
 * Get a result by calling a function with automatic retry
 * @param asyncFn
 * @param retryMaxAttempts
 * @param retryPauseMs
 * @returns
 */
export async function getResultWithRetry<T = any>(
    asyncFn: () => Promise<Result<T>>,
    retryMaxAttempts: number = 2,
    retryPauseMs: number = 1000,
): Promise<Result<T>> {
    let retryCount = 0;
    while (true) {
        try {
            const result = await asyncFn();
            if (result.success || retryCount >= retryMaxAttempts) {
                return result;
            }
        } catch (e: any) {
            if (retryCount >= retryMaxAttempts) {
                throw e;
            }
        }
        await pause(retryPauseMs);
        retryCount++;
        retryPauseMs *= 2; // Use exponential backoff for retries
    }
}

/**
 * Pause for given # of ms before resuming async execution
 * @param ms
 * @returns
 */
export function pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
