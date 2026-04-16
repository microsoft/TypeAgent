// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    encodeWikipediaTitle,
    getPageObject,
    getPageMarkdown,
} from "../src/wikipedia.js";
import { WikipediaApiSettings } from "../src/wikipedia.js";

// Minimal stub — only getAPIHeaders is needed for the fetch calls under test
function makeConfig(endpoint: string): WikipediaApiSettings {
    return {
        endpoint,
        getToken: async () => "token",
        getAPIHeaders: async () => ({ Authorization: "Bearer token" }),
    };
}

describe("encodeWikipediaTitle", () => {
    test("replaces spaces with underscores", () => {
        expect(encodeWikipediaTitle("Johann Sebastian Bach")).toBe(
            "Johann_Sebastian_Bach",
        );
    });

    test("percent-encodes special characters", () => {
        expect(encodeWikipediaTitle("Ångström")).toBe("%C3%85ngstr%C3%B6m");
    });

    test("leaves plain ASCII titles unchanged", () => {
        expect(encodeWikipediaTitle("Berlin")).toBe("Berlin");
    });
});

describe("getPageObject locale", () => {
    let capturedUrl: string;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = async (input: string | URL | Request) => {
            capturedUrl = input.toString();
            return { ok: false } as Response; // return undefined from the function under test
        };
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("defaults to 'en' locale", async () => {
        const config = makeConfig("https://api.example.com/");
        await getPageObject("Berlin", config);
        expect(capturedUrl).toContain("/en/");
    });

    test("uses supplied locale in URL", async () => {
        const config = makeConfig("https://api.example.com/");
        await getPageObject("Berlin", config, "de");
        expect(capturedUrl).toContain("/de/");
        expect(capturedUrl).not.toContain("/en/");
    });

    test("constructs correct URL shape for 'fr'", async () => {
        const config = makeConfig("https://api.example.com/");
        await getPageObject("Paris", config, "fr");
        expect(capturedUrl).toBe(
            "https://api.example.com/core/v1/wikipedia/fr/page/Paris/bare",
        );
    });
});

describe("getPageMarkdown locale", () => {
    let capturedUrl: string;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = async (input: string | URL | Request) => {
            capturedUrl = input.toString();
            return { ok: false } as Response;
        };
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("defaults to 'en' locale", async () => {
        const config = makeConfig("https://api.example.com/");
        await getPageMarkdown("Berlin", config);
        expect(capturedUrl).toContain("/en/");
    });

    test("uses supplied locale in URL", async () => {
        const config = makeConfig("https://api.example.com/");
        await getPageMarkdown("Berlin", config, "de");
        expect(capturedUrl).toContain("/de/");
        expect(capturedUrl).not.toContain("/en/");
    });

    test("constructs correct URL shape for 'ja'", async () => {
        const config = makeConfig("https://api.example.com/");
        await getPageMarkdown("Tokyo", config, "ja");
        expect(capturedUrl).toBe("https://api.example.com/ja/page/Tokyo");
    });
});
