// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { error, success } from "typechat";
import { callJsonApiWithPool, PoolRequestContext } from "../src/restClient.js";
import { EndpointPool } from "../src/endpointPool.js";

// Build a minimal pool with stubbed ApiSettings. The tests don't exercise any
// real HTTP — we stub global fetch.
function makePool(
    endpoints: { suffix: string; priority: number; endpoint: string }[],
): EndpointPool {
    return {
        modelKey: "test",
        members: endpoints.map((e) => ({
            suffix: e.suffix,
            priority: e.priority,
            mode: "PAYG",
            settings: {
                provider: "azure",
                modelType: "chat",
                endpoint: e.endpoint,
                apiKey: "test-key",
                maxRetryAttempts: 1,
            } as any,
            cooldownUntil: 0,
            consecutive429s: 0,
            consecutiveSuccesses: 0,
        })),
    };
}

function jsonResponse(
    status: number,
    body: any,
    headers?: Record<string, string>,
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...(headers ?? {}) },
    });
}

function mockBuildRequest(): (
    member: any,
) => Promise<ReturnType<typeof success<PoolRequestContext>>> {
    return async () =>
        success({ headers: { "api-key": "test" }, body: { hello: "world" } });
}

describe("callJsonApiWithPool — one-member shortcut", () => {
    const origFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = origFetch;
    });

    test("delegates to fetchWithRetry; returns parsed JSON", async () => {
        let fetchCalls = 0;
        const fetchMock = async () => {
            fetchCalls++;
            return jsonResponse(200, { ok: true });
        };
        (globalThis as any).fetch = fetchMock;

        const pool = makePool([
            { suffix: "", priority: 1, endpoint: "https://only.example/x" },
        ]);
        const result = await callJsonApiWithPool(pool, mockBuildRequest());
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toEqual({ ok: true });
        }
        expect(fetchCalls).toBe(1);
    });
});

describe("callJsonApiWithPool — multi-member rotation", () => {
    const origFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = origFetch;
    });

    test("rotates away from a 429 to a healthy member", async () => {
        // First pick returns 429, next returns 200. Seed the RNG via
        // Math.random — we build a 2-tier pool so order is deterministic
        // (tier 1 is tried first; on 429, tier 2 is picked).
        const calls: string[] = [];
        (globalThis as any).fetch = async (url: string) => {
            calls.push(url);
            if (url.includes("first")) {
                return jsonResponse(
                    429,
                    { error: "rate limit" },
                    { "Retry-After": "1" },
                );
            }
            return jsonResponse(200, { served_by: url });
        };

        const pool = makePool([
            { suffix: "A", priority: 1, endpoint: "https://first.example/x" },
            { suffix: "B", priority: 2, endpoint: "https://second.example/x" },
        ]);
        const result = await callJsonApiWithPool(pool, mockBuildRequest(), {
            overallBudgetMs: 30_000,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect((result.data as any).served_by).toBe(
                "https://second.example/x",
            );
        }
        // First call went to tier-1, which 429'd; rotated to tier-2.
        expect(calls[0]).toContain("first");
        expect(calls[1]).toContain("second");
    });

    test("marks the 429 member as cooling so next call picks someone else", async () => {
        let call = 0;
        (globalThis as any).fetch = async (url: string) => {
            call++;
            if (url.includes("first")) {
                return jsonResponse(
                    429,
                    { error: "rate limit" },
                    { "Retry-After": "5" },
                );
            }
            return jsonResponse(200, { served_by: url, call });
        };

        const pool = makePool([
            { suffix: "A", priority: 1, endpoint: "https://first.example/x" },
            { suffix: "B", priority: 1, endpoint: "https://second.example/x" },
        ]);
        // Run a couple of calls. Once A is throttled, subsequent calls should
        // prefer B. Since both are priority 1, random-within-tier will
        // occasionally pick A again before its cooldown expires, but the pick
        // logic should skip cooling members and return B.
        await callJsonApiWithPool(pool, mockBuildRequest(), {
            overallBudgetMs: 30_000,
        });
        // Now A is cooling. Next call should go only to B.
        const r2 = await callJsonApiWithPool(pool, mockBuildRequest(), {
            overallBudgetMs: 30_000,
        });
        expect(r2.success).toBe(true);
        if (r2.success) {
            expect((r2.data as any).served_by).toBe("https://second.example/x");
        }
    });

    test("non-transient 4xx (401) returns immediately without rotating", async () => {
        const calls: string[] = [];
        (globalThis as any).fetch = async (url: string) => {
            calls.push(url);
            return jsonResponse(401, { error: "unauthorized" });
        };

        const pool = makePool([
            { suffix: "A", priority: 1, endpoint: "https://first.example/x" },
            { suffix: "B", priority: 2, endpoint: "https://second.example/x" },
        ]);
        const result = await callJsonApiWithPool(pool, mockBuildRequest());
        expect(result.success).toBe(false);
        expect(calls).toHaveLength(1); // did NOT rotate
    });

    test("5xx on tier-1 rotates to tier-2", async () => {
        const calls: string[] = [];
        (globalThis as any).fetch = async (url: string) => {
            calls.push(url);
            if (url.includes("first")) {
                return jsonResponse(503, { error: "service unavailable" });
            }
            return jsonResponse(200, { served_by: url });
        };

        const pool = makePool([
            { suffix: "A", priority: 1, endpoint: "https://first.example/x" },
            { suffix: "B", priority: 2, endpoint: "https://second.example/x" },
        ]);
        const result = await callJsonApiWithPool(pool, mockBuildRequest(), {
            overallBudgetMs: 30_000,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect((result.data as any).served_by).toBe(
                "https://second.example/x",
            );
        }
        expect(calls[0]).toContain("first");
        expect(calls[1]).toContain("second");
        // 5xx marks the member transient, not throttled, so consecutive429s
        // stays 0 — verified via the next call still attempting tier-1 since
        // the transient floor is 5s and our mock gives it back.
        expect(pool.members[0].consecutive429s).toBe(0);
    });

    test("multi-hop: tier-1 fails, tier-2 fails, tier-3 succeeds", async () => {
        const calls: string[] = [];
        (globalThis as any).fetch = async (url: string) => {
            calls.push(url);
            if (url.includes("first")) {
                return jsonResponse(
                    429,
                    { error: "rate limit" },
                    { "Retry-After": "1" },
                );
            }
            if (url.includes("second")) {
                return jsonResponse(502, { error: "bad gateway" });
            }
            return jsonResponse(200, { served_by: url });
        };

        const pool = makePool([
            { suffix: "A", priority: 1, endpoint: "https://first.example/x" },
            { suffix: "B", priority: 2, endpoint: "https://second.example/x" },
            { suffix: "C", priority: 3, endpoint: "https://third.example/x" },
        ]);
        const result = await callJsonApiWithPool(pool, mockBuildRequest(), {
            overallBudgetMs: 30_000,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect((result.data as any).served_by).toBe(
                "https://third.example/x",
            );
        }
        expect(calls.map((c) => c.match(/\w+\.example/)?.[0])).toEqual([
            "first.example",
            "second.example",
            "third.example",
        ]);
    });

    test("429 Retry-After is honored by pool cooldown", async () => {
        (globalThis as any).fetch = async (url: string) => {
            if (url.includes("first")) {
                return jsonResponse(
                    429,
                    { error: "rate limit" },
                    { "Retry-After": "7" }, // 7 seconds
                );
            }
            return jsonResponse(200, { served_by: url });
        };

        const pool = makePool([
            { suffix: "A", priority: 1, endpoint: "https://first.example/x" },
            { suffix: "B", priority: 2, endpoint: "https://second.example/x" },
        ]);
        const before = Date.now();
        await callJsonApiWithPool(pool, mockBuildRequest(), {
            overallBudgetMs: 30_000,
        });
        // Retry-After: 7 should land member A's cooldown at least ~7s out.
        // markThrottled uses max(retryAfterMs, base * 2^n); first 429 so
        // base=2s, and retryAfter=7s wins.
        expect(pool.members[0].cooldownUntil).toBeGreaterThanOrEqual(
            before + 7000 - 100,
        );
    });

    test("all cooling: wrapper sleeps until soonest member recovers", async () => {
        // Pre-seed both members as cooling in the near future. Wrapper should
        // sleep until the earliest one expires, then serve that request.
        (globalThis as any).fetch = async (url: string) =>
            jsonResponse(200, { served_by: url });

        const pool = makePool([
            { suffix: "A", priority: 1, endpoint: "https://a.example/x" },
            { suffix: "B", priority: 2, endpoint: "https://b.example/x" },
        ]);
        const now = Date.now();
        pool.members[0].cooldownUntil = now + 500; // soonest
        pool.members[1].cooldownUntil = now + 2000;

        const start = Date.now();
        const result = await callJsonApiWithPool(pool, mockBuildRequest(), {
            overallBudgetMs: 30_000,
        });
        const elapsed = Date.now() - start;
        expect(result.success).toBe(true);
        // Slept roughly 500ms then served with A.
        expect(elapsed).toBeGreaterThanOrEqual(450);
        expect(elapsed).toBeLessThan(2000);
        if (result.success) {
            expect((result.data as any).served_by).toBe("https://a.example/x");
        }
    });

    test("overall budget exhaustion returns the last error", async () => {
        // Every member always 429s; wrapper should exhaust the budget and
        // return an error rather than looping forever.
        let attempts = 0;
        (globalThis as any).fetch = async (_url: string) => {
            attempts++;
            return jsonResponse(
                429,
                { error: "rate limit" },
                { "Retry-After": "10" },
            );
        };

        const pool = makePool([
            { suffix: "A", priority: 1, endpoint: "https://a.example/x" },
            { suffix: "B", priority: 2, endpoint: "https://b.example/x" },
        ]);
        const start = Date.now();
        const result = await callJsonApiWithPool(pool, mockBuildRequest(), {
            overallBudgetMs: 600, // 600ms: enough to hit both, not enough to wait for Retry-After=10s
        });
        const elapsed = Date.now() - start;
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.message).toMatch(/429/);
        }
        // Must respect the budget — bounded slack for Promise microtasks.
        expect(elapsed).toBeLessThan(2000);
        // Should have made at least 2 attempts (one per member) before giving up.
        expect(attempts).toBeGreaterThanOrEqual(2);
    });

    test("network error (fetch throws) rotates as transient failure", async () => {
        const calls: string[] = [];
        (globalThis as any).fetch = async (url: string) => {
            calls.push(url);
            if (url.includes("first")) {
                throw new TypeError("fetch failed"); // undici network-error shape
            }
            return jsonResponse(200, { served_by: url });
        };

        const pool = makePool([
            { suffix: "A", priority: 1, endpoint: "https://first.example/x" },
            { suffix: "B", priority: 2, endpoint: "https://second.example/x" },
        ]);
        const result = await callJsonApiWithPool(pool, mockBuildRequest(), {
            overallBudgetMs: 30_000,
        });
        expect(result.success).toBe(true);
        expect(calls[0]).toContain("first");
        expect(calls[1]).toContain("second");
        // Network error should NOT bump the 429 counter.
        expect(pool.members[0].consecutive429s).toBe(0);
    });

    test("buildRequest failure bubbles out without rotation", async () => {
        const calls: string[] = [];
        (globalThis as any).fetch = async (url: string) => {
            calls.push(url);
            return jsonResponse(200, { ok: true });
        };
        const failingBuild = async () => error("token acquisition failed");

        const pool = makePool([
            { suffix: "A", priority: 1, endpoint: "https://a.example/x" },
            { suffix: "B", priority: 2, endpoint: "https://b.example/x" },
        ]);
        const result = await callJsonApiWithPool(pool, failingBuild as any);
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.message).toContain("token acquisition failed");
        }
        // Never reached fetch — buildRequest is the first thing after pickEndpoint.
        expect(calls).toHaveLength(0);
    });

    test("tier-1 recovers after cooldown expires and becomes preferred again", async () => {
        // Setup: tier-1 has a short cooldown that has already passed; tier-2
        // is healthy. Selector should prefer tier-1 on the next call.
        (globalThis as any).fetch = async (url: string) =>
            jsonResponse(200, { served_by: url });

        const pool = makePool([
            { suffix: "A", priority: 1, endpoint: "https://a.example/x" },
            { suffix: "B", priority: 2, endpoint: "https://b.example/x" },
        ]);
        // Cooldown already expired.
        pool.members[0].cooldownUntil = Date.now() - 1000;

        const result = await callJsonApiWithPool(pool, mockBuildRequest(), {
            overallBudgetMs: 30_000,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect((result.data as any).served_by).toBe("https://a.example/x");
        }
    });
});
