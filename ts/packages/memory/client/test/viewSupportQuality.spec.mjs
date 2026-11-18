// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { viewSupportQualitySchema } from "../dist/viewProtocol.js";
import { viewSummarySchema } from "../dist/inventoryProtocol.js";

const quality = {
    status: "partiallySupported",
    confidence: 0.5,
    unresolvedCategories: ["newContentSupport"],
    decisions: [
        {
            category: "newContentSupport",
            status: "partiallySupported",
            choiceConfidence: 0.99,
        },
        { category: "quantity", status: "not_asserted" },
    ],
};

test("client quality preserves partial status, inapplicable decisions and independent native confidence", () => {
    assert.deepEqual(viewSupportQualitySchema.parse(quality), quality);
    assert.equal(
        viewSupportQualitySchema.safeParse({ ...quality, confidence: 0.99 })
            .success,
        false,
    );
    assert.equal(
        viewSupportQualitySchema.safeParse({
            ...quality,
            unresolvedCategories: [],
        }).success,
        false,
    );
    assert.equal(
        viewSupportQualitySchema.safeParse({
            ...quality,
            decisions: [...quality.decisions, quality.decisions[0]],
        }).success,
        false,
    );
});

test("summary protocol preserves quality while legacy summaries remain unscored", () => {
    const summary = {
        corpusId: "corpus",
        viewId: "article",
        revisionId: "r1",
        state: "draft",
        content: { kind: "wiki", title: "Grounded article" },
        maintained: true,
        publication: {
            viewId: "article",
            indexState: "absent",
            reason: "Draft only",
        },
    };
    assert.deepEqual(
        viewSummarySchema.parse({ ...summary, quality }).quality,
        quality,
    );
    assert.equal(viewSummarySchema.parse(summary).quality, undefined);
});
