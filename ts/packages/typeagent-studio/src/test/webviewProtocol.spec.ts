// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { parseWebviewMessage } from "../webviewKit/protocol.js";

test("parseWebviewMessage accepts well-formed messages", () => {
    assert.deepEqual(parseWebviewMessage({ type: "ready" }), {
        type: "ready",
    });
    assert.deepEqual(parseWebviewMessage({ type: "reconnect" }), {
        type: "reconnect",
    });
    assert.deepEqual(
        parseWebviewMessage({ type: "run", requestId: 3, agent: "player" }),
        {
            type: "run",
            requestId: 3,
            agent: "player",
            versionA: "",
            versionB: "",
        },
    );
    // Version fields are carried through when supplied as strings.
    assert.deepEqual(
        parseWebviewMessage({
            type: "run",
            requestId: 4,
            agent: "player",
            versionA: "HEAD",
            versionB: "working tree",
        }),
        {
            type: "run",
            requestId: 4,
            agent: "player",
            versionA: "HEAD",
            versionB: "working tree",
        },
    );
    // Non-string version fields fall back to empty (→ working tree downstream).
    assert.deepEqual(
        parseWebviewMessage({
            type: "run",
            requestId: 5,
            agent: "player",
            versionA: 42,
            versionB: null,
        }),
        {
            type: "run",
            requestId: 5,
            agent: "player",
            versionA: "",
            versionB: "",
        },
    );
});

test("parseWebviewMessage rejects malformed / hostile input", () => {
    assert.equal(parseWebviewMessage(undefined), undefined);
    assert.equal(parseWebviewMessage(null), undefined);
    assert.equal(parseWebviewMessage("ready"), undefined);
    assert.equal(parseWebviewMessage({ type: "bogus" }), undefined);
    // run requires both a numeric requestId and a string agent.
    assert.equal(
        parseWebviewMessage({ type: "run", agent: "player" }),
        undefined,
    );
    assert.equal(
        parseWebviewMessage({ type: "run", requestId: "1", agent: "player" }),
        undefined,
    );
    assert.equal(parseWebviewMessage({ type: "run", requestId: 1 }), undefined);
    // Non-finite / non-integer / negative request ids are rejected (they could
    // never match latestRequestId and would wedge the webview state).
    assert.equal(
        parseWebviewMessage({ type: "run", requestId: NaN, agent: "player" }),
        undefined,
    );
    assert.equal(
        parseWebviewMessage({
            type: "run",
            requestId: Infinity,
            agent: "player",
        }),
        undefined,
    );
    assert.equal(
        parseWebviewMessage({ type: "run", requestId: 1.5, agent: "player" }),
        undefined,
    );
    assert.equal(
        parseWebviewMessage({ type: "run", requestId: -1, agent: "player" }),
        undefined,
    );
});
