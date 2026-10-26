// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { measureParser, percentile } from "../../agent-session-scale.mjs";
import * as parser from "../../../packages/memory/service/dist/agentSessionParsing.js";

test("parser scale checks exact spans, complete tails and honest metric boundaries", async () => {
    const result = await measureParser(parser, {
        events: 1001,
        targetBytes: 512 * 1024,
    });
    assert.equal(result.accepted, 1001);
    assert.equal(result.exactSpanChecks, 1001);
    assert.equal(result.chunks, 11);
    assert.ok(result.inputBytes >= 512 * 1024);
    assert.equal(result.semanticExtraction, "not-run");
    assert.equal(result.providerCalls, 0);
});

test("scale inputs are bounded and latency quantiles are measured", async () => {
    await assert.rejects(measureParser(parser, { events: 100001 }));
    assert.equal(percentile([5, 1, 4, 2, 3], 0.5), 3);
    assert.equal(percentile([5, 1, 4, 2, 3], 0.95), 5);
});
