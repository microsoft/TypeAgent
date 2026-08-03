// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { responseReadyDurationMs } from "../src/latency.js";

test("uses the final response boundary instead of post-response cleanup", () => {
    assert.equal(
        responseReadyDurationMs({
            durationMs: 500,
            latencyTimeline: {
                schemaVersion: 1,
                runStartedAt: new Date(0).toISOString(),
                primaryTurnCompletedMs: 120,
                repairTurnCompletedMs: 150,
                cleanupCompletedMs: 300,
                telemetryReadCompletedMs: 500,
                completedMs: 500,
            },
        }),
        150,
    );
});

test("falls back to the retained wall duration for legacy incomplete timelines", () => {
    assert.equal(responseReadyDurationMs({ durationMs: 500 }), 500);
});
