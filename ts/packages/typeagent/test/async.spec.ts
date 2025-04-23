// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { callWithRetry } from "../src/async.js";

describe("async", () => {
    const timeoutMs = 1000 * 5 * 60;
    test(
        "callWithRetry",
        async () => {
            let expectedResult = "Yay";

            let callNumber = 0;
            let callsToFail = 2;
            const result = await callWithRetry(async () => api(), 2, 1000);
            expect(result).toBe(expectedResult);

            callNumber = 0;
            callsToFail = 3; // Fail all retries. Make sure exception falls through
            let lastError: any | undefined;
            try {
                await callWithRetry(async () => api(), 2, 1000);
            } catch (e) {
                lastError = e;
            }
            expect(lastError).toBeDefined();

            async function api(): Promise<string> {
                ++callNumber;
                if (callNumber <= callsToFail) {
                    throw new Error("Too many requests");
                }
                return expectedResult;
            }
        },
        timeoutMs,
    );
});
