// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewBuildSnapshot } from "../src/viewTypes.js";
import { indexedLocator } from "../src/indexedFragments.js";

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
let request: unknown;
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...actual,
    openai: {
        ...actual.openai,
        getChatModelSettings: () => ({ provider: "azure" }),
        createChatModel: () => ({
            complete: async (
                messages: Array<{ role: string; content: string }>,
            ) => {
                instructions = messages.find(
                    (message) => message.role === "system",
                )!.content;
                request = JSON.parse(
                    messages.find((message) => message.role === "user")!
                        .content,
                );
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
    const blocks = [
        {
            sourceId: "charter",
            revisionId: "charter-current",
            blockOrdinal: 0,
            score: 1,
            text: "Atlas rollout is active; its incident is closed. Capacity validation is blocked pending peak-memory evidence. Accountable role: service owner; assigned person unknown. Acceptance review proposed; due date unknown.",
        },
        {
            sourceId: "mixed-review",
            revisionId: "review-current",
            blockOrdinal: 0,
            score: 1,
            text: "Mira reviews Atlas capacity, not service accountability. Atlas rehearsal acceptance is complete, not rollout. Boreal rollout is blocked on a separate dependency; its owner is Leo.",
        },
    ];
    const input: ViewBuildSnapshot = {
        corpusId: "corpus",
        actor: "test",
        definition: {
            viewId: "project",
            kind: "projectBrief",
            selector: {
                kind: "sources",
                sources: blocks.map(({ sourceId, revisionId }) => ({
                    sourceId,
                    revisionId,
                })),
            },
            projectSummary: {
                construction: "informational-project-summary-v1",
                query: "Atlas rollout",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        expectedVersion: 0,
        bounds: {},
        inputs: blocks.map((block) => ({
            sourceId: block.sourceId,
            revisionId: block.revisionId,
            title: block.sourceId,
            content: block.text,
            contentHash: "synthetic-current-input",
            passages: [
                {
                    sourceId: block.sourceId,
                    revisionId: block.revisionId,
                    locator: indexedLocator(block, 0, block.text.length),
                    excerpt: block.text,
                },
            ],
        })),
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
    expect(request).toEqual({
        query: "Atlas rollout",
        aliases: [],
        fragments: blocks.map((block, position) => ({
            id: `f${position}`,
            sourceId: block.sourceId,
            revisionId: block.revisionId,
            text: block.text,
        })),
    });
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
    expect(instructions).toContain(
        "approximately 4000 tokens in the final JSON only, excluding reasoning",
    );
    expect(instructions).toContain(
        "Preserve required evidence even when that needs a longer answer",
    );
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
    expect(instructions).toContain("independently useful explanatory purpose");
    expect(instructions).toContain("sentence-shaped state");
    expect(instructions).toContain("platform overview");
    await expect(
        createConfiguredViewSynthesisAdapter("test").assessWikiSubject!(
            input,
            [
                {
                    viewId: "existing",
                    revisionId: "current",
                    query: "accountability",
                    aliases: [],
                    title: "Accountability",
                    prose: "Same scoped concept",
                    proseTruncated: false,
                    sharedFragmentIds: ["f0"],
                    candidateFragmentIds: ["f0"],
                    contributingSources: [
                        { sourceId: "source", revisionId: "revision" },
                    ],
                    sourceOverlap: { shared: 1, union: 1, subset: true },
                },
            ],
            new AbortController().signal,
        ),
    ).rejects.toThrow("Controlled provider failure");
    expect(instructions).toContain(
        "before generating a new automatic Wiki page",
    );
    expect(instructions).toContain("exact shared fragment IDs");
    expect(instructions).toContain("actual page prose");
    expect(instructions).toContain("ALL essential distinctions");
});
