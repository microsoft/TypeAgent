// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    apiSettingsFromEnv,
    createBingSearch,
    DEFAULT_BING_ENDPOINT,
} from "../src/bing.js";

describe("bing endpoint", () => {
    const originalFetch = globalThis.fetch;
    let requested: string[];

    beforeEach(() => {
        requested = [];
        globalThis.fetch = (async (input: unknown) => {
            requested.push(String(input));
            return new Response(
                JSON.stringify({
                    webPages: {
                        value: [
                            {
                                name: "n",
                                url: "https://example.com",
                                snippet: "s",
                            },
                        ],
                    },
                    value: [],
                }),
                {
                    status: 200,
                    headers: { "content-type": "application/json" },
                },
            );
        }) as typeof globalThis.fetch;
        jest.spyOn(console, "warn").mockImplementation(() => {});
        jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    test("apiSettingsFromEnv leaves the endpoint unset by default", () => {
        const settings = apiSettingsFromEnv({ BING_API_KEY: "key" });
        expect(settings.endpoint).toBeUndefined();
        expect(DEFAULT_BING_ENDPOINT).toBe(
            "https://api.bing.microsoft.com/v7.0",
        );
    });

    test("apiSettingsFromEnv reads BING_ENDPOINT", () => {
        const settings = apiSettingsFromEnv({
            BING_API_KEY: "key",
            BING_ENDPOINT: " http://127.0.0.1:8080/v7.0 ",
        });
        expect(settings.endpoint).toBe("http://127.0.0.1:8080/v7.0");
    });

    test("requests go to Bing without an endpoint", async () => {
        const client = await createBingSearch({ apiKey: "key" });
        expect(client.success).toBe(true);
        if (!client.success) return;
        const pages = await client.data.webSearch("typeagent");
        await client.data.imageSearch("typeagent");
        expect(pages.success).toBe(true);
        expect(requested).toEqual([
            "https://api.bing.microsoft.com/v7.0/search?q=typeagent",
            "https://api.bing.microsoft.com/v7.0/images/search?q=typeagent",
        ]);
    });

    test("requests go to the configured endpoint", async () => {
        const client = await createBingSearch({
            apiKey: "key",
            endpoint: "http://127.0.0.1:8080/v7.0/",
        });
        expect(client.success).toBe(true);
        if (!client.success) return;
        await client.data.webSearch("typeagent", { count: 3 });
        await client.data.imageSearch("typeagent");
        expect(requested).toEqual([
            "http://127.0.0.1:8080/v7.0/search?q=typeagent&count=3",
            "http://127.0.0.1:8080/v7.0/images/search?q=typeagent",
        ]);
    });
});
