// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Tests for CHANGE 4 — guarded routing of the REST handler generator in
// scaffolderHandler.ts's buildHandler. REST generation must only kick in
// when an apiSurface has a resolved baseUrl AND the pattern is one that
// models a direct REST integration (schema-grammar default, external-api);
// explicit non-REST patterns must keep their own dedicated builders even
// when an apiSurface happens to be attached.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildHandler } from "../src/scaffolder/scaffolderHandler.js";
import type { ApiSurface } from "../src/discovery/discoveryHandler.js";

function makeSurface(baseUrl?: string): ApiSurface {
    return {
        integrationName: "bookApi",
        discoveredAt: new Date().toISOString(),
        source: "https://api.example.com/openapi.json",
        actions: [
            {
                name: "getBook",
                description: "Get a book",
                method: "GET",
                path: "/books/{book_id}",
                parameters: [
                    {
                        name: "book_id",
                        type: "string",
                        required: true,
                        in: "path",
                    },
                ],
                sourceUrl: "https://api.example.com/openapi.json",
            },
        ],
        ...(baseUrl !== undefined ? { baseUrl } : {}),
    };
}

describe("buildHandler REST routing", () => {
    test("routes to the REST generator for the default (schema-grammar) pattern when baseUrl is set", async () => {
        const output = await buildHandler(
            "bookApi",
            "BookApi",
            "schema-grammar",
            makeSurface("https://api.example.com/v3"),
        );
        assert.match(output, /callRest\(/);
        assert.match(output, /"getBook"/);
    });

    test("routes to the REST generator for the external-api pattern when baseUrl is set", async () => {
        const output = await buildHandler(
            "bookApi",
            "BookApi",
            "external-api",
            makeSurface("https://api.example.com/v3"),
        );
        assert.match(output, /callRest\(/);
    });

    test("does NOT route to REST for websocket-bridge even when baseUrl is set", async () => {
        const output = await buildHandler(
            "bookApi",
            "BookApi",
            "websocket-bridge",
            makeSurface("https://api.example.com/v3"),
        );
        assert.doesNotMatch(output, /callRest\(/);
    });

    test("does NOT route to REST for native-platform even when baseUrl is set", async () => {
        const output = await buildHandler(
            "bookApi",
            "BookApi",
            "native-platform",
            makeSurface("https://api.example.com/v3"),
        );
        assert.doesNotMatch(output, /callRest\(/);
    });

    test("falls back to the schema-grammar stub when no baseUrl is present", async () => {
        const output = await buildHandler(
            "bookApi",
            "BookApi",
            "schema-grammar",
            makeSurface(undefined),
        );
        assert.doesNotMatch(output, /callRest\(/);
    });

    test("falls back to the schema-grammar stub when there is no apiSurface at all", async () => {
        const output = await buildHandler("bookApi", "BookApi");
        assert.doesNotMatch(output, /callRest\(/);
    });
});
