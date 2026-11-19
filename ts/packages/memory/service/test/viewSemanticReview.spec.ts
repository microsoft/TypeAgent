// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseSemanticAssessment,
    pendingSemanticReview,
    semanticReviewDue,
    semanticReviewIntervalMs,
    semanticReviewFacets,
} from "../src/viewSemanticReview.js";
import type { ViewBuildSnapshot, ViewVersion } from "../src/viewTypes.js";
import { viewHash } from "../src/viewMerge.js";

const citation = {
    sourceId: "source",
    revisionId: "revision",
    locator: "chars:0-21",
    excerpt: "Acquisition is scoped.",
};
const input: ViewBuildSnapshot = {
    corpusId: "corpus",
    actor: "test",
    expectedVersion: 1,
    bounds: {},
    definition: {
        viewId: "article",
        kind: "wiki",
        selector: { kind: "sources", sources: [citation] },
        wiki: {
            construction: "informational-wiki-v1",
            query: "Acquisition",
            aliases: [],
            excludedSourceIds: [],
        },
    },
    inputs: [
        {
            sourceId: "source",
            revisionId: "revision",
            title: "Evidence",
            content: citation.excerpt,
            contentHash: viewHash(citation.excerpt),
            passages: [citation],
        },
    ],
    pipeline: "informational-wiki-v1",
    model: "test",
    fingerprint: "a".repeat(64),
};
const view: ViewVersion = {
    corpusId: input.corpusId,
    viewId: "article",
    revisionId: "accepted",
    version: 1,
    state: "draft",
    provenance: "generated",
    actor: "test",
    createdAt: "2026-11-15T00:00:00Z",
    definition: { ...input.definition, revisionId: "definition" },
    content: {
        kind: "wiki",
        construction: "informational-wiki-v1",
        status: "partial",
        title: "Acquisition",
        index: [{ pageId: "scope", title: "Scope", taxonomy: "concept" }],
        sections: [
            {
                id: "scope",
                role: "page",
                heading: "Scope",
                body: citation.excerpt,
                details: {
                    kind: "page",
                    construction: "informational-wiki-v1",
                    taxonomy: "concept",
                    note: "",
                    mergedPageIds: [],
                },
            },
        ],
        citations: [citation],
    },
    relationships: [],
};
const response = () => ({
    purpose: "Explain acquisition scope",
    facets: semanticReviewFacets(input).map((id) => ({
        id,
        state: "covered",
        reason: "Explained from original evidence",
        evidenceIds: ["f0"],
    })),
    gaps: [] as Array<{
        facetId: string;
        kind: string;
        basis: string;
        description: string;
        resolutionCondition: string;
        evidenceIds: string[];
    }>,
    separation: null,
});

test("assessment binds original evidence and rejects unsupported coverage or contradictory absence", () => {
    const raw = response();
    expect(
        parseSemanticAssessment(raw, input, view).facets[0].citations,
    ).toEqual([citation]);
    raw.facets[0].evidenceIds = [];
    expect(() => parseSemanticAssessment(raw, input, view)).toThrow(
        "Covered facet requires original evidence",
    );
    raw.facets[0].evidenceIds = ["f1"];
    expect(() => parseSemanticAssessment(raw, input, view)).toThrow(
        "unsupplied evidence",
    );
    raw.facets[0].evidenceIds = ["f0"];
    raw.gaps = [
        {
            facetId: "scope",
            kind: "contradiction",
            basis: "scope-absence",
            description: "Conflicting scope",
            resolutionCondition: "A source resolves the scope",
            evidenceIds: [],
        },
    ];
    expect(() => parseSemanticAssessment(raw, input, view)).toThrow(
        "requires original evidence",
    );
    raw.gaps[0].kind = "missing";
    const assessment = parseSemanticAssessment(raw, input, view);
    expect(assessment.gaps[0].basis).toBe("scope-absence");
    expect(assessment.gaps[0].id).toBe(
        parseSemanticAssessment(raw, input, view).gaps[0].id,
    );
    raw.facets.pop();
    expect(() => parseSemanticAssessment(raw, input, view)).toThrow(
        "omitted or duplicated",
    );
});

test("daily review is content-bound, parks repeated failures and preserves explicit cancellation", () => {
    const review = pendingSemanticReview(view);
    expect(semanticReviewDue(undefined, view)).toBe(true);
    review.state = "complete";
    review.completedAt = "2026-11-15T00:00:00Z";
    review.dueAt = new Date(
        Date.parse(review.completedAt) + semanticReviewIntervalMs,
    ).toISOString();
    expect(
        semanticReviewDue(review, view, Date.parse(review.completedAt)),
    ).toBe(false);
    expect(semanticReviewDue(review, view, Date.parse(review.dueAt))).toBe(
        true,
    );
    review.attempts = 2;
    expect(pendingSemanticReview(view, review).attempts).toBe(0);
    expect(semanticReviewDue(review, { ...view, revisionId: "new" }, 0)).toBe(
        true,
    );
    review.state = "failed";
    review.attempts = 2;
    expect(pendingSemanticReview(view, review).attempts).toBe(2);
    expect(semanticReviewDue(review, view, Date.parse(review.dueAt))).toBe(
        false,
    );
    review.state = "cancelled";
    review.attempts = 0;
    expect(semanticReviewDue(review, view, Date.parse(review.dueAt))).toBe(
        false,
    );
    expect(view.content.kind === "wiki" && view.content.status).toBe("partial");
});

test("separation is a grounded advisory proposal and cannot refer to nonexistent sections", () => {
    const raw = {
        ...response(),
        separation: {
            reason: "Two independent scopes",
            destinations: [
                {
                    purpose: "Acquisition mechanics",
                    sectionIds: ["scope"],
                    evidenceIds: ["f0"],
                },
                {
                    purpose: "Acquisition qualifications",
                    sectionIds: ["scope"],
                    evidenceIds: ["f0"],
                },
            ],
            unresolved: [
                "Retain the human-authored overview until assignment is reviewed",
            ],
        },
    };
    const before = structuredClone(view);
    expect(
        parseSemanticAssessment(raw, input, view).separation?.destinations,
    ).toHaveLength(2);
    expect(view).toEqual(before);
    raw.separation.destinations[0].sectionIds = ["absent"];
    expect(() => parseSemanticAssessment(raw, input, view)).toThrow(
        "valid sections",
    );
});
