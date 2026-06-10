// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InMemoryReplayPolicyStore,
    estimateLiveLlmCost,
    normalizeReplayMissPolicy,
} from "../src/replay/index.js";

describe("InMemoryReplayPolicyStore", () => {
    it("defaults to needs-explanation", () => {
        const store = new InMemoryReplayPolicyStore();
        expect(store.get("ws")).toBe("needs-explanation");
    });

    it("stores and returns per-workspace policy", () => {
        const store = new InMemoryReplayPolicyStore();
        store.set("ws-a", "strict-cache");
        store.set("ws-b", "live-llm");
        expect(store.get("ws-a")).toBe("strict-cache");
        expect(store.get("ws-b")).toBe("live-llm");
    });
});

describe("replay miss policy helpers", () => {
    it("normalizes invalid values to default", () => {
        expect(normalizeReplayMissPolicy(undefined)).toBe("needs-explanation");
        expect(normalizeReplayMissPolicy("bad-value")).toBe(
            "needs-explanation",
        );
        expect(normalizeReplayMissPolicy("strict-cache")).toBe("strict-cache");
    });

    it("estimates live-llm calls and cost", () => {
        expect(estimateLiveLlmCost(200, 50, 0.004)).toEqual({
            estimatedCalls: 50,
            estimatedCostUsd: 0.2,
        });
        expect(estimateLiveLlmCost(10, 99, 0.01).estimatedCalls).toBe(10);
    });
});
