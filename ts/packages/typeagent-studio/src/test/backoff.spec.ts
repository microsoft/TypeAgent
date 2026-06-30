// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { createBackoff } from "@typeagent/websocket-utils/backoff";

test("doubles from the base and clamps at the ceiling", () => {
    const backoff = createBackoff({ baseMs: 2000, maxMs: 15000 });
    assert.equal(backoff.next(), 2000);
    assert.equal(backoff.next(), 4000);
    assert.equal(backoff.next(), 8000);
    // 16000 would exceed the cap → clamped, and stays there afterwards.
    assert.equal(backoff.next(), 15000);
    assert.equal(backoff.next(), 15000);
});

test("tracks the attempt count", () => {
    const backoff = createBackoff({ baseMs: 1000, maxMs: 30000 });
    assert.equal(backoff.attempt, 0);
    backoff.next();
    assert.equal(backoff.attempt, 1);
    backoff.next();
    assert.equal(backoff.attempt, 2);
});

test("reset returns to the first delay", () => {
    const backoff = createBackoff({ baseMs: 2000, maxMs: 30000 });
    backoff.next();
    backoff.next();
    backoff.reset();
    assert.equal(backoff.attempt, 0);
    assert.equal(backoff.next(), 2000);
});

test("a max below the base clamps the first delay too", () => {
    const backoff = createBackoff({ baseMs: 5000, maxMs: 3000 });
    assert.equal(backoff.next(), 3000);
});
