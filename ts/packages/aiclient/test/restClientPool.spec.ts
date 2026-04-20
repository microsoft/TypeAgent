// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { success } from "typechat";
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
});
