// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { parseTraceMessage } from "../webviewKit/traceProtocol.js";

test("parseTraceMessage accepts well-formed messages", () => {
    assert.deepEqual(parseTraceMessage({ type: "ready" }), { type: "ready" });

    assert.deepEqual(
        parseTraceMessage({
            type: "compare-source",
            requestId: 7,
            node: "grammar-match",
        }),
        { type: "compare-source", requestId: 7, node: "grammar-match" },
    );

    assert.deepEqual(
        parseTraceMessage({
            type: "open-source",
            requestId: 2,
            side: "a",
            node: "grammar-match",
        }),
        { type: "open-source", requestId: 2, side: "a", node: "grammar-match" },
    );
    assert.deepEqual(
        parseTraceMessage({
            type: "open-source",
            requestId: 3,
            side: "b",
            node: "action",
        }),
        { type: "open-source", requestId: 3, side: "b", node: "action" },
    );
});

test("parseTraceMessage rejects malformed or unknown messages", () => {
    // Not an object / missing type.
    assert.equal(parseTraceMessage(undefined), undefined);
    assert.equal(parseTraceMessage(null), undefined);
    assert.equal(parseTraceMessage("ready"), undefined);
    assert.equal(parseTraceMessage({}), undefined);
    assert.equal(parseTraceMessage({ type: "nope" }), undefined);

    // compare-source needs a numeric requestId and a valid node.
    assert.equal(parseTraceMessage({ type: "compare-source" }), undefined);
    assert.equal(
        parseTraceMessage({
            type: "compare-source",
            requestId: "1",
            node: "action",
        }),
        undefined,
    );
    assert.equal(
        parseTraceMessage({
            type: "compare-source",
            requestId: 1,
            node: "cache-consult",
        }),
        undefined,
    );

    // open-source needs a numeric requestId, a valid side, and a valid node.
    assert.equal(
        parseTraceMessage({ type: "open-source", side: "a", node: "action" }),
        undefined,
    );
    assert.equal(
        parseTraceMessage({
            type: "open-source",
            requestId: 1,
            side: "c",
            node: "action",
        }),
        undefined,
    );
    assert.equal(
        parseTraceMessage({
            type: "open-source",
            requestId: 1,
            side: "a",
            node: "cache-consult",
        }),
        undefined,
    );
});
