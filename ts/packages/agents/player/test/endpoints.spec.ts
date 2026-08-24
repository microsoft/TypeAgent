// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getUserDevices,
    invalidateUserDevicesCache,
} from "../src/endpoints.js";
import { SpotifyService } from "../src/service.js";

function createService(): SpotifyService {
    return {
        tokenProvider: {
            getAccessToken: async () => "access-token",
        },
    } as SpotifyService;
}

function devicesResponse(name: string) {
    return new Response(
        JSON.stringify({
            devices: [{ id: "device-id", name }],
        }),
        { status: 200 },
    );
}

function mockFetch(...responses: Response[]) {
    let callCount = 0;
    globalThis.fetch = async () => responses[callCount++];
    return () => callCount;
}

describe("getUserDevices", () => {
    const originalFetch = globalThis.fetch;
    const originalDateNow = Date.now;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        Date.now = originalDateNow;
    });

    test("reuses a recent response", async () => {
        const service = createService();
        const getCallCount = mockFetch(devicesResponse("Denon"));

        const first = await getUserDevices(service);
        const second = await getUserDevices(service);

        expect(second).toBe(first);
        expect(getCallCount()).toBe(1);
    });

    test("coalesces concurrent requests", async () => {
        const service = createService();
        const getCallCount = mockFetch(devicesResponse("Denon"));

        await Promise.all([getUserDevices(service), getUserDevices(service)]);

        expect(getCallCount()).toBe(1);
    });

    test("refreshes after the cache expires", async () => {
        const service = createService();
        let now = 1_000;
        Date.now = () => now;
        const getCallCount = mockFetch(
            devicesResponse("First"),
            devicesResponse("Second"),
        );

        await getUserDevices(service);
        now = 31_001;
        const refreshed = await getUserDevices(service);

        expect(refreshed.devices[0].name).toBe("Second");
        expect(getCallCount()).toBe(2);
    });

    test("uses stale data when the development quota is exhausted", async () => {
        const service = createService();
        let now = 1_000;
        Date.now = () => now;
        const getCallCount = mockFetch(
            devicesResponse("Denon"),
            new Response(
                JSON.stringify({
                    error: {
                        status: 429,
                        message: "Too many requests",
                        reason: "QUOTA_EXCEEDED",
                    },
                }),
                { status: 429, statusText: "Too Many Requests" },
            ),
        );

        const cached = await getUserDevices(service);
        now = 31_001;
        const fallback = await getUserDevices(service);
        const reusedFallback = await getUserDevices(service);

        expect(fallback).toBe(cached);
        expect(reusedFallback).toBe(cached);
        expect(getCallCount()).toBe(2);
    });

    test("supports explicit invalidation", async () => {
        const service = createService();
        const getCallCount = mockFetch(
            devicesResponse("First"),
            devicesResponse("Second"),
        );

        await getUserDevices(service);
        invalidateUserDevicesCache(service);
        const refreshed = await getUserDevices(service);

        expect(refreshed.devices[0].name).toBe("Second");
        expect(getCallCount()).toBe(2);
    });
});
