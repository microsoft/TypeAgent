// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getRetryAfterMs } from "../src/restClient.js";

describe("restClient", () => {
    test("retryPauseHeader", () => {
        const retryPauseDefault = 1000;
        const retryPauseSeconds = 5;
        let headers: Record<string, string> = {
            "Retry-After": retryPauseSeconds.toString(),
        };
        let response = new Response(undefined, {
            headers,
        });
        let retryPauseMs = getRetryAfterMs(response, retryPauseDefault);
        expect(retryPauseMs).toEqual(retryPauseSeconds * 1000);

        headers = {
            "retry-after": retryPauseSeconds.toString(),
        };
        response = new Response(undefined, {
            headers,
        });
        retryPauseMs = getRetryAfterMs(response, retryPauseDefault);
        expect(retryPauseMs).toEqual(retryPauseSeconds * 1000);

        const futureOffset = 25 * 1000;
        const now = Date.now();
        const future = new Date(now + futureOffset);
        headers = {
            "Retry-After": future.toUTCString(),
        };
        response = new Response(undefined, {
            headers,
        });
        retryPauseMs = getRetryAfterMs(response, retryPauseDefault);
        expect(retryPauseMs).toBeLessThanOrEqual(futureOffset);

        headers = {
            "retry-after-x": retryPauseSeconds.toString(),
        };
        response = new Response(undefined, {
            headers,
        });
        retryPauseMs = getRetryAfterMs(response, retryPauseDefault);
        expect(retryPauseMs).toEqual(retryPauseDefault);
    });
});
