// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { createAiReviewInput, validateAiReview } from "./quality-ai-review.mjs";

function fixture(overrides = {}) {
    const input = createAiReviewInput({
        query: "Approval",
        artifact: {
            viewId: "page",
            sections: [{ id: "page", heading: "Approval" }],
        },
        sources: [
            {
                id: "original-update",
                text: "A draft or trial does not establish production approval.",
            },
        ],
        selectedEvidence: [
            {
                sourceId: "original-update",
                revisionId: "r1",
                excerpt:
                    "A draft or trial does not establish production approval.",
            },
        ],
        citationFragments: [
            {
                id: "f0",
                sourceId: "original-update",
                revisionId: "r1",
                text: "A draft or trial does not establish production approval.",
            },
        ],
        fields: [
            {
                id: "field-0",
                path: "/content/summary",
                text: "A draft or trial does not establish production approval [f0].",
                authority: "source",
            },
            {
                id: "field-1",
                path: "/content/index",
                text: "host-generated",
                authority: "host-metadata",
            },
        ],
        facts: [
            {
                id: "f0",
                statement:
                    "A draft or trial does not establish production approval.",
                importance: 3,
                witnesses: [
                    {
                        sourceId: "original-update",
                        quote: "A draft or trial does not establish production approval.",
                    },
                ],
            },
        ],
        prohibitedInferences: [
            { id: "c1", statement: "Do not assert a draft or trial occurred." },
        ],
        ...overrides,
    });
    const review = {
        fields: [
            {
                id: "field-0",
                verdict: "supported",
                sourceIds: ["source-0"],
                reason: "Exact substantive statement preserved; f0 is a production citation.",
            },
        ],
        facts: [
            {
                id: "fact-0",
                verdict: "preserved",
                fieldIds: ["field-0"],
                reason: "Qualification preserved.",
            },
        ],
        constraints: [
            {
                id: "constraint-0",
                verdict: "absent",
                fieldIds: [],
                reason: "No occurrence is asserted; no disclaimer required.",
            },
        ],
        usefulness: 4,
        explanation: "Concise supported qualification.",
    };
    return { input, review };
}

test("empty fact rubrics cannot produce a success-shaped coverage score", () => {
    assert.throws(() => fixture({ facts: [] }), /nonempty/);
});

test("unknown field authority cannot silently remove a factual field", () => {
    assert.throws(
        () =>
            fixture({
                fields: [
                    {
                        id: "field-0",
                        path: "/content/summary",
                        text: "A claim",
                        authority: "invented",
                    },
                ],
            }),
        /explicit authority/,
    );
});

test("metadata is excluded and production citations cannot collide with rubric IDs", () => {
    const { input, review } = fixture();
    assert.equal(input.fields.length, 1);
    assert.deepEqual(input.hostMetadataPaths, ["/content/index"]);
    assert.equal(JSON.stringify(input).includes("field-1"), false);
    assert.equal(input.citationBindings[0].alias, "f0");
    assert.equal(input.citationBindings[0].sourceId, "source-0");
    assert.equal(input.facts[0].id, "fact-0");
    const summary = validateAiReview(input, review);
    assert.equal(summary.unsupportedFields, 0);
    assert.equal(summary.weightedCoverage, 1);
    assert.equal(summary.prohibitedInferenceViolations, 0);
});

test("citation aliases use captured fragments rather than accumulated evidence order", () => {
    const { input: original } = fixture();
    const update = original.citationBindings[0];
    const baseline = {
        sourceId: "original-baseline",
        revisionId: "r0",
        excerpt: "Earlier evidence.",
    };
    const { input } = fixture({
        sources: [
            { id: baseline.sourceId, text: baseline.excerpt },
            { id: update.originalSourceId, text: update.excerpt },
        ],
        selectedEvidence: [
            baseline,
            baseline,
            {
                sourceId: update.originalSourceId,
                revisionId: update.revisionId,
                excerpt: update.excerpt,
            },
        ],
        citationFragments: [
            { id: "f0", ...baseline, text: baseline.excerpt },
            {
                id: "f1",
                sourceId: update.originalSourceId,
                revisionId: update.revisionId,
                text: update.excerpt,
            },
        ],
    });
    assert.equal(input.citationBindings.length, 2);
    assert.equal(input.citationBindings[1].alias, "f1");
    assert.equal(input.citationBindings[1].sourceId, "source-1");
});

test("citation aliases cannot be inferred without captured synthesis fragments", () => {
    assert.throws(
        () => fixture({ citationFragments: undefined }),
        /captured synthesis fragments/i,
    );
});

test("captured citation revisions must match selected indexed evidence", () => {
    assert.throws(
        () =>
            fixture({
                citationFragments: [
                    {
                        id: "f0",
                        sourceId: "original-update",
                        revisionId: "wrong-revision",
                        text: "A draft or trial does not establish production approval.",
                    },
                ],
            }),
        /selected indexed evidence/,
    );
});

for (const mode of [
    "missing-field",
    "extra-metadata-field",
    "unknown-source",
    "rubric-source-collision",
    "disclaimer-required",
    "unlocated-inference",
]) {
    test(`review rejects ${mode}`, () => {
        const { input, review } = fixture();
        if (mode === "missing-field") review.fields = [];
        if (mode === "extra-metadata-field")
            review.fields.push({ ...review.fields[0], id: "field-1" });
        if (mode === "unknown-source")
            review.fields[0].sourceIds = ["invented"];
        if (mode === "rubric-source-collision")
            review.fields[0].sourceIds = ["fact-0"];
        if (mode === "disclaimer-required")
            review.constraints[0].fieldIds = ["field-0"];
        if (mode === "unlocated-inference")
            review.constraints[0].verdict = "present";
        assert.throws(() => validateAiReview(input, review));
    });
}
