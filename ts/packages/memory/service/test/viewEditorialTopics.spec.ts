// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "@typeagent/aiclient";
import { createConfiguredTopicGenerator } from "../src/topicGeneration.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import type { ViewBuildSnapshot } from "../src/viewTypes.js";

test("consequential topic rejection clears unsupported prose without stopping other original scopes", async () => {
    const occurrences = [
        {
            sourceId: "orders",
            label: "Orders",
            text: "Orders command median is withdrawn; local acceptance is not rollout approval.",
        },
        {
            sourceId: "identity",
            label: "Identity",
            text: "Identity has only local compatibility acceptance; rollout remains blocked.",
        },
    ].map(({ sourceId, label, text }) =>
        indexedTopicOccurrence(
            { sourceId, revisionId: "r2", blockOrdinal: 0, text, score: 1 },
            label,
            0,
        ),
    );
    const input: ViewBuildSnapshot = {
        corpusId: "editorial",
        actor: "offline",
        expectedVersion: 0,
        definition: {
            viewId: "topics",
            kind: "wiki",
            selector: { kind: "sources", sources: [] },
        },
        bounds: {},
        inputs: [],
        pipeline: "topics-v1",
        model: "offline",
        fingerprint: "a".repeat(64),
        topicInput: { occurrences },
        influenceSources: occurrences.map(({ sourceId, revisionId }) => ({
            sourceId,
            revisionId,
        })),
    };
    const prompts: string[] = [];
    const model: ChatModel = {
        completionSettings: {},
        complete: async (messages) => {
            const prompt = JSON.stringify(messages);
            prompts.push(prompt);
            const unsafe = prompt.includes("Orders");
            const response = prompt.includes("Check the ACTUAL")
                ? {
                      safe: !unsafe,
                      failures: unsafe
                          ? ["correction-withdrawal", "scope-state"]
                          : [],
                  }
                : prompt.includes("Organize supplied topics")
                  ? { parents: [], related: [] }
                  : {
                        summary: unsafe
                            ? "Orders rollout is complete and approved; withdrawn command median remains current."
                            : "Identity has local compatibility acceptance only; rollout remains blocked.",
                        evidenceIds: [0],
                    };
            return { success: true, data: JSON.stringify(response) };
        },
    };
    const errors = import.meta.jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
    try {
        const snapshot = await createConfiguredTopicGenerator(undefined, model)(
            input,
            new AbortController().signal,
        );
        const orders = snapshot.nodes.find((node) => node.scope === "orders")!;
        const identity = snapshot.nodes.find(
            (node) => node.scope === "identity",
        )!;
        expect(orders.summaryState).toBe("failed");
        expect(orders.summary).toBe("");
        expect(orders.limits.join(" ")).toContain("critical-distinction");
        expect(orders.limits.join(" ")).not.toContain("median remains current");
        expect(identity.summaryState).toBe("ready");
        expect(identity.summary).toContain(
            "local compatibility acceptance only",
        );
        expect(snapshot.occurrences).toEqual(occurrences);
        expect(snapshot.influenceSources).toEqual(input.influenceSources);
        expect(
            prompts.filter((prompt) => prompt.includes("Check the ACTUAL")),
        ).toHaveLength(2);
        expect(prompts.join("\n")).not.toContain("synopsis:generated");
        expect(errors).toHaveBeenCalledTimes(1);
    } finally {
        errors.mockRestore();
    }
});
