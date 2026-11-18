// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { wikiAmbiguityAttention } from "./memoryHubWikiAmbiguity";
import type { WikiAmbiguityReview } from "@typeagent/memory-service";

function review(): WikiAmbiguityReview {
    return {
        id: "review",
        corpusId: "corpus",
        jobId: "job",
        candidateId: "candidate",
        version: 3,
        createdAt: "2026-11-15",
        updatedAt: "2026-11-15",
        state: "needsReview",
        reason: "Sol identity unresolved; complete proposal retained",
        assessment: {
            disposition: "ambiguous",
            purpose: "product",
            reason: "uncertain",
            canonicalViewId: "",
            sharedFragmentIds: [],
            ambiguousViewIds: [],
            essentialDistinctions: [],
        },
        participants: [
            {
                id: "candidate",
                revisionId: null,
                input: {
                    corpusId: "corpus",
                    actor: "test",
                    model: "offline",
                    fingerprint: "f",
                    definition: {
                        viewId: "candidate",
                        kind: "wiki",
                        selector: { kind: "sources", sources: [] },
                    },
                    expectedVersion: 0,
                    bounds: {},
                    pipeline: "informational-wiki-v1",
                    inputs: [
                        {
                            sourceId: "source",
                            revisionId: "r1",
                            title: "Original source",
                            content:
                                "Complete original evidence, not generated page prose.",
                            contentHash: "h",
                        },
                    ],
                },
            },
        ],
        request: {
            model: "GPT_6_1_SOL",
            logicalRequests: 1,
            state: "returned",
            transportRetries: 0,
        },
    };
}
function button(host: HTMLElement, label: string) {
    return [...host.querySelectorAll("button")].find(
        (entry) => entry.textContent === label,
    )!;
}

test("Inbox preview retains source-bound proposal and submits guarded human keep-separate action", async () => {
    const current = review();
    const resolve = jest.fn().mockResolvedValue({
        ...current,
        state: "resolved",
        reason: "Human decision verified",
    });
    const refresh = jest.fn().mockResolvedValue(undefined);
    const card = wikiAmbiguityAttention(current, resolve, refresh);
    expect(card.detail.textContent).toContain("No generated body is available");
    expect(card.detail.textContent).toContain("Complete original evidence");
    expect(card.detail.textContent).toContain("GPT_6_1_SOL");
    expect(card.detail.textContent).toContain("transport retries: 0");
    button(card.detail, "Keep separate").click();
    await new Promise((done) => setTimeout(done, 0));
    expect(resolve).toHaveBeenCalledWith({
        corpusId: "corpus",
        reviewId: "review",
        expectedVersion: 3,
        action: "keep_separate",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
});

test("human edits revalidate the COMPLETE grouping; stale/failed actions stay explicit", async () => {
    const resolve = jest
        .fn()
        .mockRejectedValue(new Error("Relevant page revision conflict"));
    const refresh = jest.fn();
    const card = wikiAmbiguityAttention(review(), resolve, refresh);
    const editor = card.detail.querySelector("textarea")!;
    const proposal = JSON.parse(editor.value);
    proposal.reason = "Edited source-bound proposal";
    editor.value = JSON.stringify(proposal);
    button(card.detail, "Revalidate edited proposal").click();
    await new Promise((done) => setTimeout(done, 0));
    expect(resolve.mock.calls[0][0].resolution).toEqual(proposal);
    expect(card.detail.textContent).toContain(
        "Review not applied: Relevant page revision conflict",
    );
    expect(button(card.detail, "Approve verified combination").disabled).toBe(
        true,
    );
    expect(refresh).not.toHaveBeenCalled();
});

test("complete receipts and original-page provenance remain visible and navigable", () => {
    const current = review();
    current.request.raw = "Complete original Sol response";
    current.verification = [
        { ids: ["candidate"], error: "Native identity uncertain" },
    ];
    current.participants[0].revisionId = "page-r1";
    current.participants[0].page = {
        viewId: "candidate",
        revisionId: "page-r1",
        content: {
            kind: "wiki",
            title: "Original article",
            sections: [],
            citations: [],
            coverageNote: "Original qualification",
        },
    } as NonNullable<WikiAmbiguityReview["participants"][number]["page"]>;
    const open = jest.fn();
    const card = wikiAmbiguityAttention(current, jest.fn(), jest.fn(), open);
    expect(card.detail.textContent).toContain("Complete original Sol response");
    expect(card.detail.textContent).toContain("Native identity uncertain");
    expect(card.detail.textContent).toContain("Original qualification");
    button(card.detail, "Open original article").click();
    expect(open).toHaveBeenCalledWith("corpus", "candidate", "page-r1");
});

test("unverified Sol result never presents an enabled approval action", () => {
    const card = wikiAmbiguityAttention(review(), jest.fn(), jest.fn());
    expect(button(card.detail, "Approve verified combination").disabled).toBe(
        true,
    );
});
