// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { otel } from "@typeagent/telemetry";
import { success } from "typechat";
import type { EndpointPool } from "../src/endpointPool.js";
import {
    callApiWithPool,
    fetchWithRetry,
    getRetryAfterMs,
} from "../src/restClient.js";

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

// A `Result` failure carries only a message, and that message quotes the
// provider's response body, so telemetry must not parse it. The transport is
// the last place that still knows what actually happened, so it attaches the
// bounded facts there (see `attachTelemetryErrorClassification`).
describe("restClient failure classification", () => {
    const origFetch = globalThis.fetch;
    const url = "https://example.test/openai/deployments/foo/chat/completions";

    afterEach(() => {
        globalThis.fetch = origFetch;
    });

    function respondWith(status: number): void {
        (globalThis as any).fetch = async () =>
            new Response(JSON.stringify({ error: "secret tenant detail" }), {
                status,
                headers: { "content-type": "application/json" },
            });
    }

    const statusCases: readonly [number, string, boolean][] = [
        [400, "validation", false],
        [401, "authentication", false],
        [403, "authorization", false],
        [404, "validation", false],
    ];

    test.each(statusCases)(
        "carries the classification for a non-transient %i",
        async (status, errorCategory, retryable) => {
            respondWith(status);
            const result = await fetchWithRetry(url);
            expect(result.success).toBe(false);
            expect(otel.readTelemetryErrorClassification(result)).toEqual({
                errorCategory,
                httpStatus: status,
                retryable,
            });
        },
    );

    test("carries the classification once throttling exhausts its retries", async () => {
        respondWith(429);
        const result = await fetchWithRetry(url, undefined, 0, 1);
        expect(result.success).toBe(false);
        expect(otel.readTelemetryErrorClassification(result)).toEqual({
            errorCategory: "rate_limit",
            httpStatus: 429,
            retryable: true,
        });
    });

    test("classifies a transport-level network failure", async () => {
        (globalThis as any).fetch = async () => {
            throw Object.assign(new TypeError("fetch failed"), {
                cause: Object.assign(new Error("connect ECONNREFUSED"), {
                    code: "ECONNREFUSED",
                }),
            });
        };
        const result = await fetchWithRetry(url);
        expect(result.success).toBe(false);
        expect(otel.readTelemetryErrorClassification(result)).toEqual({
            errorCategory: "network",
            errorCode: "ECONNREFUSED",
            retryable: true,
        });
    });

    test("classifies our own deadline as a retryable timeout", async () => {
        // `fetchWithTimeout` aborts on its own deadline and re-throws a
        // `TimeoutError`, which must not read as a caller cancellation. The
        // abort is raised as a named `Error` rather than a `DOMException`
        // because Jest's VM realm gives the test a `DOMException` whose
        // prototype chain does not reach the realm's `Error`, which would
        // defeat the `instanceof Error` check under test.
        (globalThis as any).fetch = (
            _input: unknown,
            init?: { signal?: AbortSignal },
        ) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => {
                    reject(
                        Object.assign(new Error("The operation was aborted."), {
                            name: "AbortError",
                        }),
                    );
                });
            });
        const result = await fetchWithRetry(url, undefined, 0, 1, 10);
        expect(result.success).toBe(false);
        expect(otel.readTelemetryErrorClassification(result)).toEqual({
            errorCategory: "timeout",
            retryable: true,
        });
    });

    test("never carries the provider message in the classification", async () => {
        respondWith(401);
        const result = await fetchWithRetry(url);
        const classification = otel.readTelemetryErrorClassification(result);
        expect(JSON.stringify(classification)).not.toContain("secret");
        // The message stays available for the private local diagnostics.
        expect(result.success === false && result.message).toContain("secret");
    });

    // `internal` is a claim about our own code. A transport failure nobody
    // recognized is not that, and attaching it here would also overwrite the
    // model wrapper's `provider` fallback (see `finishLlmCall`), which is the
    // truthful description of "the provider call failed and nothing said why".
    test("attaches nothing when the failure carries no recognized signal", async () => {
        (globalThis as any).fetch = async () => {
            throw new TypeError("fetch failed");
        };
        const result = await fetchWithRetry(url);
        expect(result.success).toBe(false);
        expect(otel.readTelemetryErrorClassification(result)).toBeUndefined();
    });
});

// One dropped connection, two code paths: `callFetch` resolving to `undefined`
// is handled by a throw on the single-endpoint path and inline on the pool
// path. They must describe it the same way, or the same outage reads as
// `network` from one deployment and as nothing (or `internal`) from another.
describe("restClient dropped-connection parity", () => {
    const origFetch = globalThis.fetch;
    const url = "https://example.test/openai/deployments/foo/chat/completions";

    afterEach(() => {
        globalThis.fetch = origFetch;
    });

    function makePool(endpoints: readonly string[]): EndpointPool {
        return {
            modelKey: "test",
            members: endpoints.map((endpoint, index) => ({
                suffix: `M${index}`,
                priority: index + 1,
                mode: "PAYG",
                settings: {
                    provider: "azure",
                    modelType: "chat",
                    endpoint,
                    apiKey: "test-key",
                    maxRetryAttempts: 1,
                } as any,
                cooldownUntil: 0,
                consecutive429s: 0,
                consecutiveSuccesses: 0,
            })),
        };
    }

    test("single-endpoint and multi-endpoint report the same classification", async () => {
        // Resolving without a Response is what a dropped connection looks like
        // here, and it is not a thrown error either path could classify.
        (globalThis as any).fetch = async () => undefined;

        const single = await fetchWithRetry(url);
        // Two members, so the pool takes its own rotation branch rather than
        // delegating to the single-endpoint path.
        const pooled = await callApiWithPool(
            makePool([url, "https://second.example.test/chat"]),
            async () => success({ headers: {}, body: { hello: "world" } }),
            { overallBudgetMs: 200 },
        );

        expect(single.success).toBe(false);
        expect(pooled.success).toBe(false);
        const expected = { errorCategory: "network", retryable: true };
        expect(otel.readTelemetryErrorClassification(single)).toEqual(expected);
        expect(otel.readTelemetryErrorClassification(pooled)).toEqual(expected);
    });
});
