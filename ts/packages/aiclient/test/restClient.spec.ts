// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fetchWithRetry, getRetryAfterMs } from "../src/restClient.js";

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

    test("fetchWithRetry names the endpoint on a non-transient error", async () => {
        const origFetch = globalThis.fetch;
        try {
            (globalThis as any).fetch = async () =>
                new Response(JSON.stringify({ error: "bad request" }), {
                    status: 400,
                    headers: { "content-type": "application/json" },
                });
            const url =
                "https://example.test/openai/deployments/foo/chat/completions";
            const result = await fetchWithRetry(url);
            expect(result.success).toBe(false);
            if (!result.success) {
                // The endpoint is named so a 4xx says which deployment was hit.
                expect(result.message).toContain(url);
                expect(result.message).toContain("400");
            }
        } finally {
            globalThis.fetch = origFetch;
        }
    });
});
