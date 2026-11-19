// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewBuildSnapshot } from "../src/viewTypes.js";
import { indexedLocator } from "../src/indexedFragments.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import { withWikiChoiceResponses } from "./wikiChoiceTestModel.js";

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
let completion:
    | { success: true; data: string }
    | { success: false; message: string } = {
    success: false,
    message: "Controlled provider failure",
};
const model = withWikiChoiceResponses({
    completionSettings: {},
    complete: async (messages) => {
        if (typeof messages === "string")
            throw new Error("Expected structured prompt messages");
        instructions = String(
            messages.find((message) => message.role === "system")!.content,
        );
        request = JSON.parse(
            String(
                messages.find((message) => message.role === "user")!.content,
            ),
        );
        return completion;
    },
});
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...actual,
    openai: {
        ...actual.openai,
        getChatModelSettings: () => ({ provider: "azure" }),
        createChatModel: () => model,
    },
}));
const { createConfiguredViewSynthesisAdapter } = await import(
    "../src/viewSynthesis.js"
);

test("configured factual checks require exact output/source diagnostics and compact judgments", async () => {
    const text = "The owner is unknown. No production deployment is approved.";
    const block = {
        sourceId: "source",
        revisionId: "r1",
        blockOrdinal: 0,
        text,
        score: 1,
    };
    const input: ViewBuildSnapshot = {
        corpusId: "corpus",
        actor: "test",
        expectedVersion: 0,
        bounds: {},
        pipeline: "informational-wiki-v1",
        model: "test",
        fingerprint: "test",
        definition: {
            viewId: "article",
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "source", revisionId: "r1" }],
            },
            wiki: {
                construction: "informational-wiki-v1",
                query: "Deployment",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        inputs: [
            {
                sourceId: "source",
                revisionId: "r1",
                title: "Source",
                content: text,
                contentHash: "source",
                passages: [
                    {
                        sourceId: "source",
                        revisionId: "r1",
                        locator: indexedLocator(block, 0, text.length),
                        excerpt: text,
                    },
                ],
            },
        ],
    };
    const output = hydrateInformational(input, {
        title: "Deployment",
        summary: "Production is approved.",
        prose: "The owner is unknown.",
        status: "partial",
        limits: "Owner unknown",
        citationIds: ["f0"],
    });
    const assessment = {
        safe: false,
        failures: ["scope-state"],
        diagnostics: [
            {
                kind: "scope-state",
                location: "/content/summary",
                quote: "Production is approved.",
                reason: "Approval contradicts the supplied source.",
                evidence: [
                    {
                        fragmentId: "f0",
                        quote: text,
                    },
                ],
                correction: "Report production as unapproved.",
            },
        ],
    };
    const adapter = createConfiguredViewSynthesisAdapter("test");
    const check = () =>
        adapter.checkEditorial!(input, output, new AbortController().signal);
    const native = {
        safe: assessment.safe,
        failures: assessment.failures,
        diagnostics: assessment.diagnostics.map((entry) => ({
            kind: entry.kind,
            location: entry.location,
            reason: entry.reason,
            evidenceIds: entry.evidence.map((witness) => witness.fragmentId),
            correction: entry.correction,
        })),
    };
    try {
        completion = { success: true, data: JSON.stringify(native) };
        expect(await check()).toEqual(assessment);
        expect(request).toMatchObject({
            fragments: [{ id: "f0", excerpt: text }],
        });
        expect(instructions).toContain("first builds as well as updates");
        expect(instructions).toContain(
            "historical corrected/withdrawn value is not a current",
        );
        expect(instructions).not.toContain("12000 tokens");
        completion = {
            success: true,
            data: JSON.stringify({ safe: true, failures: [] }),
        };
        await expect(check()).rejects.toThrow("invalid-assessment");
        const invented = structuredClone(native);
        invented.diagnostics[0].evidenceIds = ["f1"];
        completion = { success: true, data: JSON.stringify(invented) };
        await expect(check()).rejects.toThrow("invalid-assessment");
        completion = { success: true, data: JSON.stringify(assessment) };
        await expect(check()).rejects.toThrow("invalid-assessment");
        completion = {
            success: true,
            data: JSON.stringify({ safe: true, failures: [], diagnostics: [] }),
        };
        await expect(check()).resolves.toEqual({
            safe: true,
            failures: [],
            diagnostics: [],
        });
    } finally {
        completion = { success: false, message: "Controlled provider failure" };
    }
});

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
    expect(instructions).toContain(
        "Nonapproval, unvalidated capacity and blocked decisions",
    );
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
        "Do not infer blocked decisions from unknown states, execution from preparation, or rollout from local success",
    );
    expect(instructions).toContain(
        "internal inference limits, not additional source facts",
    );
    expect(instructions).toContain("retain source-supported distinctions");
    expect(instructions).not.toContain("Unknown is not blocked;");
    expect(instructions).toContain("older bounded successes");
    expect(instructions).toContain(
        "output budget is 4000 tokens, not a length target",
    );
    expect(instructions).toContain(
        "Preserve required evidence even when that needs a longer answer",
    );
    expect(instructions).toContain(
        "pendingOwnerReview only when capacity review is explicitly pending owner review",
    );
    expect(instructions).toContain("explain each fact and qualification once");
    expect(instructions).toContain(
        "Set limits to null when no substantive evidence gap",
    );
    expect(instructions).toContain(
        "Mention a current blocker and its supported consequence early in the summary",
    );
    expect(instructions).toContain(
        "Topic salience and maintenance scheduling priority are not issue urgency",
    );
    expect(instructions).not.toContain(
        "State missing coverage in limits; this is not exhaustive",
    );
    const rejected = {
        content: {
            kind: "projectBrief" as const,
            construction: "informational-project-summary-v1" as const,
            title: "Atlas rollout",
            summary: "REJECTED_UNTRUSTED_DIAGNOSTIC",
            sections: [],
            citations: [],
        },
        relationships: [],
        outcome: "projectSummary" as const,
        missingEvidence: [],
    };
    const assessment = { safe: false, failures: ["scope-state" as const] };
    const adapter = createConfiguredViewSynthesisAdapter("test");
    await expect(
        adapter.repairProjectSummary!(
            input,
            rejected,
            assessment,
            new AbortController().signal,
        ),
    ).rejects.toThrow("Controlled provider failure");
    expect(request).toEqual({
        query: "Atlas rollout",
        aliases: [],
        rejectedOutput: rejected.content,
        assessment,
        fragments: blocks.map((block, position) => ({
            id: `f${position}`,
            sourceId: block.sourceId,
            revisionId: block.revisionId,
            text: block.text,
        })),
    });
    expect(instructions).toContain("unchanged original indexed fragments");
    expect(instructions).toContain("untrusted diagnostics");
    expect(instructions).toContain("another rejection is final");
    expect(instructions).not.toContain("12000 tokens");
    await expect(
        adapter.repairProjectSummary!(
            { ...input, pipeline: "informational-wiki-v1" },
            rejected,
            assessment,
            new AbortController().signal,
        ),
    ).rejects.toThrow("requires an informational project target");
});

test("wiki prompt keeps retrieval identity independent of labels and separates prose from retrieval coverage limits", async () => {
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
    expect(instructions).toContain("retrieval coverage limits only in limits");
    expect(instructions).toContain("corrections, counterexamples");
    expect(instructions).toContain("Standalone admission is already complete");
    expect(instructions).toContain(
        "internal inference limits, not additional source facts",
    );
    expect(instructions).toContain(
        "Do not add a negative status assertion or generic contrast",
    );
    expect(instructions).toContain("retain source-supported distinctions");
    expect(instructions).not.toContain("Unknown is not blocked;");
    expect(instructions).toContain("do not return a purpose assessment");
    expect(instructions).not.toContain(
        "independently useful explanatory purpose",
    );
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
    expect(instructions).toContain("independently useful explanatory purpose");
    expect(instructions).toContain("sentence-shaped state");
    expect(instructions).toContain("platform overview");
    expect(instructions).toContain(
        "Assess standalone admission even when no current pages exist",
    );
    expect(instructions).toContain("exact shared fragment IDs");
    expect(instructions).toContain(
        "Canonical page prose is supplied as ordered proseWitnesses",
    );
    expect(instructions).toContain("the host binds its exact text");
    expect(instructions).toContain(
        "Keep canonicalExcerpt empty in native output",
    );
    expect(instructions).toContain("ALL essential distinctions");
});
