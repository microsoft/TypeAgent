// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { sleep } from "aiclient";

/**
 * Call an async function with retry
 * @param asyncFn Use closures to pass parameters
 * @param retryMaxAttempts maximum retry attempts. Default is 1
 * @param retryPauseMs Pause between attempts. Default is 1000 ms
 * @param shouldAbort (Optional) Inspect the error and abort
 * @returns Result<T>
 */
export async function callWithRetry<T = any>(
    asyncFn: () => Promise<T>,
    retryMaxAttempts: number = 1,
    retryPauseMs: number = 1000,
    shouldAbort?: (error: any) => boolean | undefined,
): Promise<T> {
    let retryCount = 0;
    while (true) {
        try {
            return await asyncFn();
        } catch (e: any) {
            if (
                retryCount >= retryMaxAttempts ||
                (shouldAbort && shouldAbort(e))
            ) {
                throw e;
            }
        }
        await sleep(retryPauseMs);
        retryCount++;
    }
}
