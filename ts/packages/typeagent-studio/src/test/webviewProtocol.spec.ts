// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { parseWebviewMessage } from "../webviewKit/protocol.js";

test("parseWebviewMessage accepts well-formed messages", () => {
    assert.deepEqual(parseWebviewMessage({ type: "ready" }), {
        type: "ready",
    });
    assert.deepEqual(parseWebviewMessage({ type: "pickVersion", side: "a" }), {
        type: "pickVersion",
        side: "a",
    });
    assert.deepEqual(parseWebviewMessage({ type: "pickVersion", side: "b" }), {
        type: "pickVersion",
        side: "b",
    });
    // Missing/invalid version fields coerce to the working tree; an absent mode
    // defaults to the grammar-only baseline.
    assert.deepEqual(
        parseWebviewMessage({ type: "run", requestId: 3, agent: "player" }),
        {
            type: "run",
            requestId: 3,
            agent: "player",
            versionA: { kind: "workingTree" },
            versionB: { kind: "workingTree" },
            mode: "nfa-grammar",
            validateWildcards: false,
        },
    );
    // String version fields are coerced (legacy text-field / test seam).
    assert.deepEqual(
        parseWebviewMessage({
            type: "run",
            requestId: 4,
            agent: "player",
            versionA: "HEAD",
            versionB: "working tree",
            mode: "completionBased-cache",
            validateWildcards: true,
        }),
        {
            type: "run",
            requestId: 4,
            agent: "player",
            versionA: { kind: "git", ref: "HEAD" },
            versionB: { kind: "workingTree" },
            mode: "completionBased-cache",
            validateWildcards: true,
        },
    );
    // Typed specs from a picker selection are validated and taken as-is; an
    // unknown mode value falls back to the grammar-only baseline, and a
    // non-boolean validateWildcards falls back to off.
    assert.deepEqual(
        parseWebviewMessage({
            type: "run",
            requestId: 6,
            agent: "player",
            versionA: { kind: "git", ref: "v1.0" },
            versionB: { kind: "workingTree" },
            mode: "bogus-mode",
            validateWildcards: "yes",
        }),
        {
            type: "run",
            requestId: 6,
            agent: "player",
            versionA: { kind: "git", ref: "v1.0" },
            versionB: { kind: "workingTree" },
            mode: "nfa-grammar",
            validateWildcards: false,
        },
    );
    // Non-string / malformed version fields fall back to the working tree.
    assert.deepEqual(
        parseWebviewMessage({
            type: "run",
            requestId: 5,
            agent: "player",
            versionA: 42,
            versionB: { kind: "git", ref: "" },
        }),
        {
            type: "run",
            requestId: 5,
            agent: "player",
            versionA: { kind: "workingTree" },
            versionB: { kind: "workingTree" },
            mode: "nfa-grammar",
            validateWildcards: false,
        },
    );
});

test("parseWebviewMessage rejects malformed / hostile input", () => {
    assert.equal(parseWebviewMessage(undefined), undefined);
    assert.equal(parseWebviewMessage(null), undefined);
    assert.equal(parseWebviewMessage("ready"), undefined);
    assert.equal(parseWebviewMessage({ type: "bogus" }), undefined);
    // The agent is now fixed per panel — there is no agent picker message.
    assert.equal(parseWebviewMessage({ type: "pickAgent" }), undefined);
    // Reconnect is automatic — the webview no longer sends a reconnect message.
    assert.equal(parseWebviewMessage({ type: "reconnect" }), undefined);
    // pickVersion requires a valid side.
    assert.equal(parseWebviewMessage({ type: "pickVersion" }), undefined);
    assert.equal(
        parseWebviewMessage({ type: "pickVersion", side: "c" }),
        undefined,
    );
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
