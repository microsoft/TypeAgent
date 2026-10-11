// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewBuildSnapshot } from "../src/viewTypes.js";

// Jest 29 exposes this ESM API, but @types/jest does not declare it.
const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
const actual = await import("@typeagent/aiclient");
let instructions = "";
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...actual,
    openai: {
        ...actual.openai,
        getChatModelSettings: () => ({ provider: "azure" }),
        getChatModelOutputLimit: (limit: number) => limit,
        createChatModel: () => ({
            complete: async (
                messages: Array<{ role: string; content: string }>,
            ) => {
                instructions = messages.find(
                    (message) => message.role === "system",
                )!.content;
                return {
                    success: false,
                    message: "Controlled provider failure",
                };
            },
        }),
    },
}));
const { createConfiguredViewSynthesisAdapter } = await import(
    "../src/viewSynthesis.js"
);

test("project prompt preserves qualified dimensions and initiative roles; provider failure has no fallback", async () => {
    const input: ViewBuildSnapshot = {
        corpusId: "corpus",
        actor: "test",
        definition: {
            viewId: "project",
            kind: "projectBrief",
            selector: { kind: "sources", sources: [] },
            projectSummary: {
                construction: "informational-project-summary-v1",
                query: "Atlas rollout",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        expectedVersion: 0,
        bounds: {},
        inputs: [],
        pipeline: "informational-project-summary-v1",
        model: "test",
        fingerprint: "test",
    };
    await expect(
        createConfiguredViewSynthesisAdapter("test").generate(
            input,
            new AbortController().signal,
        ),
    ).rejects.toThrow("Controlled provider failure");
    expect(instructions).toContain("blocked/unvalidated");
    expect(instructions).toContain("pendingOwnerReview");
    expect(instructions).toContain(
        "review owner from an accountable service owner",
    );
    expect(instructions).toContain(
        "Completed rehearsal acceptance does not complete rollout",
    );
    expect(instructions).toContain(
        "bind people, milestones and conditions only to the queried initiative",
    );
    expect(instructions).toContain(
        "navigation hints, not factual or project equivalence",
    );
    expect(instructions).toContain("median is not p95");
    expect(instructions).toContain(
        "Unknown is not blocked; prepared is not executed; local success is not rollout",
    );
    expect(instructions).toContain("older bounded successes");
});

test("wiki prompt keeps retrieval identity independent of labels and requires prose coverage limits", async () => {
    const input: ViewBuildSnapshot = {
        corpusId: "corpus",
        actor: "test",
        expectedVersion: 0,
        bounds: {},
        inputs: [],
        pipeline: "informational-wiki-v1",
        model: "test",
        fingerprint: "test",
        definition: {
            viewId: "concept",
            kind: "wiki",
            selector: { kind: "sources", sources: [] },
            wiki: {
                construction: "informational-wiki-v1",
                query: "accountable_role",
                aliases: ["accountable role"],
                excludedSourceIds: [],
            },
        },
    };
    await expect(
        createConfiguredViewSynthesisAdapter("test").generate(
            input,
            new AbortController().signal,
        ),
    ).rejects.toThrow("Controlled provider failure");
    expect(instructions).toContain(
        "a readable title does not expand its scope",
    );
    expect(instructions).toContain(
        "coverage limits in the prose as well as limits",
    );
    expect(instructions).toContain("corrections, counterexamples");
});
