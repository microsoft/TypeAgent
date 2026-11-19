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
        "Review request failed: Relevant page revision conflict",
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
        { ids: ["candidate"], error: "Subject identity uncertain" },
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
    expect(card.detail.textContent).toContain("Subject identity uncertain");
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

test("verified grouping submits approval once and disables stale controls", async () => {
    const current = review();
    current.resolution = {
        status: "resolved",
        reason: "Source-bound separation verified",
        groups: [
            {
                action: "keep_separate",
                ids: ["candidate"],
                survivorId: null,
                combined: null,
                sections: [],
            },
        ],
    };
    const resolve = jest.fn().mockResolvedValue({
        ...current,
        version: 4,
        state: "resolved",
    });
    const refresh = jest.fn().mockResolvedValue(undefined);
    const card = wikiAmbiguityAttention(current, resolve, refresh);
    const approve = button(card.detail, "Approve verified combination");
    expect(approve.disabled).toBe(false);
    approve.click();
    approve.click();
    await new Promise((done) => setTimeout(done, 0));
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({
        corpusId: "corpus",
        reviewId: "review",
        expectedVersion: 3,
        action: "approve",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
        [...card.detail.querySelectorAll("button")].every((b) => b.disabled),
    ).toBe(true);
});

test("malformed edited JSON is rejected before sending a review request", async () => {
    const resolve = jest.fn();
    const card = wikiAmbiguityAttention(review(), resolve, jest.fn());
    const editor = card.detail.querySelector("textarea")!;
    editor.value = JSON.stringify({ status: "resolved", groups: [] });
    button(card.detail, "Revalidate edited proposal").click();
    await new Promise((done) => setTimeout(done, 0));
    expect(resolve).not.toHaveBeenCalled();
    expect(card.detail.textContent).toContain("Review request failed:");
});

test("an Inbox refresh failure does not falsely report a returned action as unapplied", async () => {
    const current = review();
    const resolve = jest.fn().mockResolvedValue({
        ...current,
        state: "resolved",
        reason: "Drafts retained separately",
    });

    const refresh = jest.fn().mockRejectedValue(new Error("RPC unavailable"));
    const card = wikiAmbiguityAttention(current, resolve, refresh);
    button(card.detail, "Keep separate").click();
    await new Promise((done) => setTimeout(done, 0));
    expect(card.detail.textContent).toContain(
        "Review returned resolved, but Inbox refresh failed: RPC unavailable",
    );
    expect(card.detail.textContent).not.toContain("Review request failed:");
    expect(button(card.detail, "Keep separate").disabled).toBe(true);
});

test("disabled workflow preserves full evidence but exposes no applying controls", () => {
    const resolve = jest.fn();
    const card = wikiAmbiguityAttention(
        review(),
        resolve,
        jest.fn(),
        undefined,
        false,
    );
    expect(card.detail.textContent).toContain("Wiki review is disabled");
    expect(card.detail.textContent).toContain("Complete original evidence");
    expect(
        [...card.detail.querySelectorAll("button")].every((b) => b.disabled),
    ).toBe(true);
    expect(card.detail.querySelector("textarea")!.readOnly).toBe(true);
    button(card.detail, "Keep separate").click();
    expect(resolve).not.toHaveBeenCalled();
});
