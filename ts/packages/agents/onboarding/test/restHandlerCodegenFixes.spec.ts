// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Targeted regression tests for two review fixes on buildRestHandler's
// generated source text (fast, no tsc/network/server needed):
//   - Fix 1: a path parameter resolved from a local `#/components/parameters`
//     $ref (already deref'd into DiscoveredAction.parameters by
//     discoveryHandler.ts) must be substituted into the path expression via
//     the actual parameter lookup, not silently degrade to a literal
//     "undefined" segment.
//   - Fix 2: a GET (or HEAD) action with body-typed parameters must never
//     emit a `body` argument to callRest, since fetch throws for
//     GET/HEAD requests carrying a body.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRestHandler } from "../src/scaffolder/restHandlerTemplate.js";
import type { DiscoveredAction } from "../src/discovery/discoveryHandler.js";

test("path parameter (as resolved from a local $ref by discoveryHandler) is substituted, never left as a literal placeholder or undefined", async () => {
    // Shape identical to what extractOpenApiActions now produces once it
    // resolves a `{"$ref": "#/components/parameters/BookId"}` path
    // parameter inline.
    const actions: DiscoveredAction[] = [
        {
            name: "getBook",
            method: "GET",
            path: "/books/{bookId}",
            parameters: [
                {
                    name: "bookId",
                    type: "string",
                    required: true,
                    in: "path",
                },
            ],
        },
    ];
    const source = await buildRestHandler(
        "bookApi",
        "BookApi",
        "https://api.example.com/v1",
        actions,
    );

    // Must read the actual parameter (bracket-access lookup), not emit the
    // raw placeholder text or a bare `undefined` literal into the path.
    assert.match(source, /parameters\["bookId"\]/);
    assert.doesNotMatch(source, /"\{bookId\}"/);
    assert.doesNotMatch(source, /\+\s*undefined\s*\+/);
});

test("GET action with body-typed parameters never emits a body (Fix 2 regression)", async () => {
    const actions: DiscoveredAction[] = [
        {
            name: "searchBooks",
            method: "GET",
            path: "/books/search",
            parameters: [
                {
                    name: "query",
                    type: "string",
                    required: true,
                    in: "body",
                },
            ],
        },
    ];
    const source = await buildRestHandler(
        "bookApi",
        "BookApi",
        "https://api.example.com/v1",
        actions,
    );

    const caseMatch = /case "searchBooks": \{([\s\S]*?)\n {8}\}/.exec(source);
    assert.ok(caseMatch, "expected a generated case for searchBooks");
    const caseBody = caseMatch![1];
    assert.doesNotMatch(
        caseBody,
        /const body/,
        "GET actions must never construct a request body",
    );
    assert.match(
        caseBody,
        /callRest\("GET", path, query, undefined\)/,
        "GET actions must call callRest with an undefined body argument",
    );
});

test("HEAD-like semantics aside, DELETE with body-typed parameters still never emits a body", async () => {
    const actions: DiscoveredAction[] = [
        {
            name: "deleteBook",
            method: "DELETE",
            path: "/books/{bookId}",
            parameters: [
                { name: "bookId", type: "string", required: true, in: "path" },
                { name: "reason", type: "string", required: false, in: "body" },
            ],
        },
    ];
    const source = await buildRestHandler(
        "bookApi",
        "BookApi",
        "https://api.example.com/v1",
        actions,
    );
    const caseMatch = /case "deleteBook": \{([\s\S]*?)\n {8}\}/.exec(source);
    assert.ok(caseMatch, "expected a generated case for deleteBook");
    assert.doesNotMatch(caseMatch![1], /const body/);
});
