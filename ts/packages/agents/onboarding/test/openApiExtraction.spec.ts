// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Deterministic unit tests for the parseOpenApiSpec arm's extraction and
// base-URL resolution logic (CHANGE 1 & CHANGE 2 of the REST-handler-
// generation feature).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
    extractOpenApiActions,
    resolveOpenApiBaseUrl,
} from "../src/discovery/discoveryHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadBookApiSpec(): Promise<any> {
    const raw = await fs.readFile(
        path.resolve(__dirname, "fixtures/openapi/book-api.json"),
        "utf-8",
    );
    return JSON.parse(raw);
}

describe("extractOpenApiActions", () => {
    test("merges path-item-level params with operation-level params", async () => {
        const spec = await loadBookApiSpec();
        const actions = extractOpenApiActions(
            spec,
            "https://api.example.com/openapi.json",
        );

        const getBook = actions.find((a) => a.name === "getBook");
        assert.ok(getBook, "expected a getBook action");
        assert.equal(getBook!.method, "GET");
        assert.equal(getBook!.path, "/books/{book_id}");
        const getBookParamNames = getBook!.parameters?.map((p) => p.name);
        assert.ok(getBookParamNames?.includes("book_id"));
        assert.ok(getBookParamNames?.includes("include_reviews"));

        const bookIdParam = getBook!.parameters?.find(
            (p) => p.name === "book_id",
        );
        assert.equal(bookIdParam?.in, "path");
        assert.equal(bookIdParam?.required, true);

        const includeReviewsParam = getBook!.parameters?.find(
            (p) => p.name === "include_reviews",
        );
        assert.equal(includeReviewsParam?.in, "query");
    });

    test("operation-level param with the same (name, in) overrides the path-level one", () => {
        const spec = {
            openapi: "3.0.0",
            paths: {
                "/items/{id}": {
                    parameters: [
                        {
                            name: "id",
                            in: "path",
                            required: true,
                            description: "path-level",
                            schema: { type: "string" },
                        },
                    ],
                    get: {
                        operationId: "get_item",
                        parameters: [
                            {
                                name: "id",
                                in: "path",
                                required: true,
                                description: "operation-level override",
                                schema: { type: "string" },
                            },
                        ],
                    },
                },
            },
        };
        const actions = extractOpenApiActions(spec, "spec.json");
        const idParam = actions[0].parameters?.find((p) => p.name === "id");
        assert.equal(idParam?.description, "operation-level override");
        // Only one merged entry, not two.
        assert.equal(
            actions[0].parameters?.filter((p) => p.name === "id").length,
            1,
        );
    });

    test("captures request body properties with in: body", () => {
        const spec = {
            openapi: "3.0.0",
            paths: {
                "/books/{book_id}": {
                    put: {
                        operationId: "update_book",
                        requestBody: {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            title: { type: "string" },
                                        },
                                        required: ["title"],
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };
        const actions = extractOpenApiActions(spec, "spec.json");
        const titleParam = actions[0].parameters?.find(
            (p) => p.name === "title",
        );
        assert.equal(titleParam?.in, "body");
        assert.equal(titleParam?.required, true);
    });

    test("skips a $ref'd path item entirely (inline-only v1 scope)", () => {
        const spec = {
            openapi: "3.0.0",
            paths: {
                "/shared": { $ref: "#/components/pathItems/Shared" },
                "/real": { get: { operationId: "get_real" } },
            },
        };
        const actions = extractOpenApiActions(spec, "spec.json");
        assert.equal(actions.length, 1);
        assert.equal(actions[0].name, "getReal");
    });

    test("skips $ref'd parameters", () => {
        const spec = {
            openapi: "3.0.0",
            paths: {
                "/x": {
                    get: {
                        operationId: "get_x",
                        parameters: [{ $ref: "#/components/parameters/Foo" }],
                    },
                },
            },
        };
        const actions = extractOpenApiActions(spec, "spec.json");
        assert.equal(actions[0].parameters?.length, 0);
    });
});

describe("resolveOpenApiBaseUrl", () => {
    test("resolves a relative servers[0].url against the fetched spec location, preserving path", async () => {
        const spec = await loadBookApiSpec();
        const baseUrl = resolveOpenApiBaseUrl(
            spec,
            "https://api.example.com/openapi.json",
            "https://api.example.com/openapi.json",
        );
        assert.equal(baseUrl, "https://api.example.com/v3");
    });

    test("preserves an absolute server URL's path component", () => {
        const spec = { servers: [{ url: "https://api.example.com/v1" }] };
        const baseUrl = resolveOpenApiBaseUrl(
            spec,
            "https://api.example.com/openapi.json",
        );
        assert.equal(baseUrl, "https://api.example.com/v1");
    });

    test("substitutes server variables from their default values", () => {
        const spec = {
            servers: [
                {
                    url: "https://{host}.example.com/{basePath}",
                    variables: {
                        host: { default: "api" },
                        basePath: { default: "v2" },
                    },
                },
            ],
        };
        const baseUrl = resolveOpenApiBaseUrl(spec, "spec.json");
        assert.equal(baseUrl, "https://api.example.com/v2");
    });

    test("leaves baseUrl unset when a server variable has no default", () => {
        const spec = {
            servers: [
                {
                    url: "https://{host}.example.com",
                    variables: {},
                },
            ],
        };
        const baseUrl = resolveOpenApiBaseUrl(spec, "spec.json");
        assert.equal(baseUrl, undefined);
    });

    test("falls back to the fetched spec's origin when servers is absent", () => {
        const baseUrl = resolveOpenApiBaseUrl(
            {},
            "https://api.example.com/openapi.json",
            "https://api.example.com/openapi.json",
        );
        assert.equal(baseUrl, "https://api.example.com");
    });

    test("leaves baseUrl unset for a local file spec source with a relative servers url", () => {
        const spec = { servers: [{ url: "/v3" }] };
        const baseUrl = resolveOpenApiBaseUrl(spec, "./local-spec.json");
        assert.equal(baseUrl, undefined);
    });

    test("leaves baseUrl unset for a local file spec source with no servers entry", () => {
        const baseUrl = resolveOpenApiBaseUrl({}, "./local-spec.json");
        assert.equal(baseUrl, undefined);
    });
});
