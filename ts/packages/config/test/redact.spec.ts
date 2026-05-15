// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    redactFlat,
    redactTree,
    shouldRedact,
    REDACTED,
} from "../src/redact.js";

describe("shouldRedact", () => {
    test.each([
        ["azure.openai.api_key", "secret-value", true],
        ["AZURE_OPENAI_API_KEY", "secret-value", true],
        ["bing.api_key", "abc", true],
        ["my.password", "pw", true],
        ["auth.token", "xyz", true],
        ["DB_CREDENTIAL", "x", true],
    ])("flags %s as secret", (key, val, expected) => {
        expect(shouldRedact(key, val)).toBe(expected);
    });

    test.each([
        ["azure.openai.endpoint", "https://x"],
        ["max_concurrency", "32"],
        ["AZURE_OPENAI_MAX_TIMEOUT", "120000"],
    ])("does not flag non-secret key %s", (key, val) => {
        expect(shouldRedact(key, val)).toBe(false);
    });

    test("does not flag identity sentinel", () => {
        expect(shouldRedact("AZURE_OPENAI_API_KEY", "identity")).toBe(false);
    });

    test("does not flag empty string", () => {
        expect(shouldRedact("AZURE_OPENAI_API_KEY", "")).toBe(false);
    });

    test("does not flag non-string values", () => {
        expect(shouldRedact("api_key", 42)).toBe(false);
        expect(shouldRedact("api_key", true)).toBe(false);
    });
});

describe("redactFlat", () => {
    test("masks sensitive keys, leaves others intact", () => {
        const flat = {
            AZURE_OPENAI_ENDPOINT: "https://x",
            AZURE_OPENAI_API_KEY: "sk-test",
            OPENAI_MAX_CONCURRENCY: "32",
            BING_API_KEY: "abc",
        };
        const out = redactFlat(flat);
        expect(out.AZURE_OPENAI_ENDPOINT).toBe("https://x");
        expect(out.OPENAI_MAX_CONCURRENCY).toBe("32");
        expect(out.AZURE_OPENAI_API_KEY).toBe(REDACTED);
        expect(out.BING_API_KEY).toBe(REDACTED);
    });

    test("preserves identity sentinel", () => {
        const out = redactFlat({ AZURE_OPENAI_API_KEY: "identity" });
        expect(out.AZURE_OPENAI_API_KEY).toBe("identity");
    });
});

describe("redactTree", () => {
    test("recursively redacts nested objects", () => {
        const tree = {
            azure: {
                openai: {
                    endpoint: "https://x",
                    api_key: "sk-test",
                },
            },
            max_concurrency: 32,
            extras: {
                BING_API_KEY: "secret",
            },
        };
        const out = redactTree(tree) as typeof tree;
        expect(out.azure.openai.endpoint).toBe("https://x");
        expect(out.azure.openai.api_key).toBe(REDACTED);
        expect(out.max_concurrency).toBe(32);
        expect(out.extras.BING_API_KEY).toBe(REDACTED);
    });

    test("leaves the input unchanged (no mutation)", () => {
        const tree = { azure: { openai: { api_key: "sk-test" } } };
        const before = JSON.stringify(tree);
        redactTree(tree);
        expect(JSON.stringify(tree)).toBe(before);
    });
});
