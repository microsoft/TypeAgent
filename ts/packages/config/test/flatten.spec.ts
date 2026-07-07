// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { flatten, mergeFlat } from "../src/flatten.js";

describe("flatten", () => {
    test("returns empty for null/undefined/empty input", () => {
        expect(flatten(null)).toEqual({});
        expect(flatten(undefined)).toEqual({});
        expect(flatten({})).toEqual({});
    });

    test("flattens nested maps with underscore-joined uppercase keys", () => {
        const out = flatten({
            azure: {
                openai: {
                    endpoint: "https://example.invalid/chat",
                    api_key: "identity",
                },
            },
        });
        expect(out).toEqual({
            AZURE_OPENAI_ENDPOINT: "https://example.invalid/chat",
            AZURE_OPENAI_API_KEY: "identity",
        });
    });

    test("preserves underscores in segment names", () => {
        const out = flatten({
            azure_openai: {
                endpoint_embedding: "https://example.invalid/embed",
            },
        });
        expect(out).toEqual({
            AZURE_OPENAI_ENDPOINT_EMBEDDING: "https://example.invalid/embed",
        });
    });

    test("flattens the typed embedding section to TYPEAGENT_EMBEDDING_* vars", () => {
        const out = flatten({
            embedding: {
                provider: "local",
                model: "Xenova/all-MiniLM-L6-v2",
                cacheDir: "/models",
            },
        });
        expect(out).toEqual({
            TYPEAGENT_EMBEDDING_PROVIDER: "local",
            TYPEAGENT_EMBEDDING_MODEL: "Xenova/all-MiniLM-L6-v2",
            TYPEAGENT_EMBEDDING_CACHE_DIR: "/models",
        });
    });

    test("env: top-level passthrough leaves keys verbatim", () => {
        const out = flatten({
            env: {
                AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS_PTU: "https://eastus-ptu",
                AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS_PTU: "k1",
            },
        });
        expect(out).toEqual({
            AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS_PTU: "https://eastus-ptu",
            AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS_PTU: "k1",
        });
    });

    test("extra: top-level passthrough leaves keys verbatim", () => {
        const out = flatten({
            extra: {
                SPOTIFY_APP_CLI: "spot-id",
                MSGRAPH_APP_CLIENTID: "graph-id",
            },
        });
        expect(out).toEqual({
            SPOTIFY_APP_CLI: "spot-id",
            MSGRAPH_APP_CLIENTID: "graph-id",
        });
    });

    test("structured form produces same flat keys as env passthrough", () => {
        const structured = flatten({
            azure: {
                openai: {
                    endpoint: "https://example.invalid/chat",
                    api_key: "identity",
                    response_format: true,
                    max_concurrency: 4,
                    max_timeout: 120000,
                },
            },
        });
        const passthrough = flatten({
            env: {
                AZURE_OPENAI_ENDPOINT: "https://example.invalid/chat",
                AZURE_OPENAI_API_KEY: "identity",
                AZURE_OPENAI_RESPONSE_FORMAT: "1",
                AZURE_OPENAI_MAX_CONCURRENCY: "4",
                AZURE_OPENAI_MAX_TIMEOUT: "120000",
            },
        });
        expect(structured).toEqual(passthrough);
    });

    test("booleans: true => '1', false => omitted", () => {
        const out = flatten({
            azure: {
                openai: {
                    response_format: true,
                    enable_logging: false,
                },
            },
        });
        expect(out).toEqual({ AZURE_OPENAI_RESPONSE_FORMAT: "1" });
    });

    test("numbers are stringified", () => {
        const out = flatten({
            azure: { openai: { max_timeout: 120000, max_concurrency: 4 } },
        });
        expect(out).toEqual({
            AZURE_OPENAI_MAX_TIMEOUT: "120000",
            AZURE_OPENAI_MAX_CONCURRENCY: "4",
        });
    });

    test("null and undefined leaves are dropped", () => {
        const out = flatten({
            azure: {
                openai: {
                    endpoint: "https://x",
                    api_key: null,
                    other: null,
                },
            },
        });
        expect(out).toEqual({ AZURE_OPENAI_ENDPOINT: "https://x" });
    });

    test("non-finite numbers are dropped", () => {
        const out = flatten({
            tuning: { ratio: Number.NaN, big: Number.POSITIVE_INFINITY },
        });
        expect(out).toEqual({});
    });

    test("arrays throw with a descriptive error", () => {
        expect(() =>
            flatten({
                azure: {
                    openai: {
                        deployments: [
                            { name: "gpt-4o", endpoint: "https://x" },
                        ] as unknown as null,
                    },
                },
            }),
        ).toThrow(/Arrays are not supported/);
    });

    test("preserves byte-identical keys for endpointPool suffix convention", () => {
        // This is the contract that lets `discoverEndpointPool` keep
        // working unchanged: the YAML must produce exactly the same
        // flat keys the existing tests rely on.
        const out = flatten({
            env: {
                AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS_PTU: "https://eastus-ptu",
                AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS_PTU: "k1",
                AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDEN: "https://sweden",
                AZURE_OPENAI_API_KEY_GPT_4_O_SWEDEN: "k2",
                AZURE_OPENAI_ENDPOINT_GPT_4_O_WESTUS: "https://westus",
                AZURE_OPENAI_API_KEY_GPT_4_O_WESTUS: "k3",
            },
        });
        expect(Object.keys(out).sort()).toEqual(
            [
                "AZURE_OPENAI_ENDPOINT_GPT_4_O_EASTUS_PTU",
                "AZURE_OPENAI_API_KEY_GPT_4_O_EASTUS_PTU",
                "AZURE_OPENAI_ENDPOINT_GPT_4_O_SWEDEN",
                "AZURE_OPENAI_API_KEY_GPT_4_O_SWEDEN",
                "AZURE_OPENAI_ENDPOINT_GPT_4_O_WESTUS",
                "AZURE_OPENAI_API_KEY_GPT_4_O_WESTUS",
            ].sort(),
        );
    });
});

describe("mergeFlat", () => {
    test("later wins", () => {
        const a = { K1: "a", K2: "a" };
        const b = { K2: "b", K3: "b" };
        const c = { K3: "c" };
        expect(mergeFlat(a, b, c)).toEqual({
            K1: "a",
            K2: "b",
            K3: "c",
        });
    });

    test("does not mutate inputs", () => {
        const a = { K1: "a" };
        const b = { K1: "b" };
        mergeFlat(a, b);
        expect(a).toEqual({ K1: "a" });
        expect(b).toEqual({ K1: "b" });
    });

    test("zero-arg returns empty object", () => {
        expect(mergeFlat()).toEqual({});
    });
});
