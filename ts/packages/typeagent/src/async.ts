// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Call an async function with automatic retry in the case of exceptions
 * @param asyncFn Use closures to pass parameters
 * @param retryMaxAttempts maximum retry attempts. Default is 2
 * @param retryPauseMs Pause between attempts. Default is 1000 ms. Uses exponential backoff
 * @param shouldAbort (Optional) Inspect the error and abort
 * @returns Result<T>
 */
export async function callWithRetry<T = any>(
    asyncFn: () => Promise<T>,
    retryMaxAttempts: number = 2,
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
