// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { resolveReasoningTimeoutMs } from "../src/reasoning/copilot.js";

const ENV_KEY = "TYPEAGENT_REASONING_TIMEOUT_MS";
const DEFAULT_MS = 20 * 60 * 1000;
const MAX_SETTIMEOUT_MS = 2_147_483_647;

describe("resolveReasoningTimeoutMs", () => {
    let saved: string | undefined;
    beforeEach(() => {
        saved = process.env[ENV_KEY];
        delete process.env[ENV_KEY];
    });
    afterEach(() => {
        if (saved === undefined) {
            delete process.env[ENV_KEY];
        } else {
            process.env[ENV_KEY] = saved;
        }
    });

    it("falls back to the 20 minute default when unset", () => {
        expect(resolveReasoningTimeoutMs()).toBe(DEFAULT_MS);
    });

    it("uses an explicit positive value as-is", () => {
        process.env[ENV_KEY] = "90000";
        expect(resolveReasoningTimeoutMs()).toBe(90000);
    });

    it("treats 0 as disabled by clamping to the max setTimeout delay", () => {
        // The SDK feeds the value straight into setTimeout, so 0 (or Infinity)
        // would fire immediately. Disabled must map to the largest safe delay.
        process.env[ENV_KEY] = "0";
        expect(resolveReasoningTimeoutMs()).toBe(MAX_SETTIMEOUT_MS);
    });

    it("clamps values above the max setTimeout delay", () => {
        process.env[ENV_KEY] = String(MAX_SETTIMEOUT_MS + 1000);
        expect(resolveReasoningTimeoutMs()).toBe(MAX_SETTIMEOUT_MS);
    });

    it("falls back to the default for negative values", () => {
        process.env[ENV_KEY] = "-5";
        expect(resolveReasoningTimeoutMs()).toBe(DEFAULT_MS);
    });

    it("falls back to the default for non-numeric values", () => {
        process.env[ENV_KEY] = "not-a-number";
        expect(resolveReasoningTimeoutMs()).toBe(DEFAULT_MS);
    });

    it("never returns the SDK's spurious 60s idle-wait default", () => {
        // Regression guard: the original bug was session.sendAndWait using its
        // built-in 60000ms idle-wait cap, which rejected legitimate long
        // multi-tool reasoning turns that were still making progress.
        expect(resolveReasoningTimeoutMs()).toBeGreaterThan(60000);
    });
});
