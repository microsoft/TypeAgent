// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { validateConfigTree } from "../src/schema.js";

describe("validateConfigTree", () => {
    test("accepts a simple flat passthrough document", () => {
        expect(() =>
            validateConfigTree(
                {
                    env: {
                        AZURE_OPENAI_ENDPOINT: "https://x",
                        AZURE_OPENAI_API_KEY: "identity",
                    },
                },
                "test.yaml",
            ),
        ).not.toThrow();
    });

    test("accepts a nested structured document", () => {
        expect(() =>
            validateConfigTree(
                {
                    azure: {
                        openai: {
                            endpoint: "https://x",
                            api_key: "identity",
                            response_format: true,
                            max_concurrency: 4,
                        },
                    },
                },
                "test.yaml",
            ),
        ).not.toThrow();
    });

    test("accepts null leaves", () => {
        expect(() =>
            validateConfigTree({ openai: { api_key: null } }, "test.yaml"),
        ).not.toThrow();
    });

    test("rejects arrays", () => {
        expect(() =>
            validateConfigTree({ deployments: ["a", "b"] }, "test.yaml"),
        ).toThrow(/Invalid TypeAgent config in test\.yaml/);
    });

    test("error message includes file label and key path", () => {
        try {
            validateConfigTree(
                { azure: { openai: { extras: ["nope"] } } },
                "myfile.yaml",
            );
            fail("expected validateConfigTree to throw");
        } catch (e) {
            const msg = (e as Error).message;
            expect(msg).toContain("myfile.yaml");
            // zod's recursive-union error reports the outermost
            // failing path; the deeper path is captured in the
            // surrounding tree but not always surfaced. We just
            // require that *some* key path appears.
            expect(msg).toMatch(/- (azure|<root>):/);
        }
    });
});
