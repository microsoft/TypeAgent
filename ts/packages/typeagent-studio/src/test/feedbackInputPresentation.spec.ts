// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import {
    buildFeedbackRecordInput,
    FEEDBACK_CATEGORY_CHOICES,
    FEEDBACK_RATING_CHOICES,
} from "../feedbackInputPresentation.js";

test("rating and category choices expose the core literals", () => {
    assert.deepEqual(
        FEEDBACK_RATING_CHOICES.map((c) => c.value),
        ["up", "down"],
    );
    assert.deepEqual(
        FEEDBACK_CATEGORY_CHOICES.map((c) => c.value),
        ["wrong-agent", "didnt-understand", "bad-response", "other"],
    );
});

test("buildFeedbackRecordInput keeps required fields and trims optionals", () => {
    const input = buildFeedbackRecordInput({
        requestId: "req-1",
        rating: "down",
        agent: "  player  ",
        utterance: "  play jazz  ",
        comment: "  wrong song  ",
        category: "bad-response",
    });
    assert.deepEqual(input, {
        requestId: "req-1",
        rating: "down",
        agent: "player",
        utterance: "play jazz",
        comment: "wrong song",
        category: "bad-response",
    });
});

test("buildFeedbackRecordInput omits blank and undefined optionals", () => {
    const input = buildFeedbackRecordInput({
        requestId: "req-2",
        rating: "up",
        agent: "   ",
        utterance: undefined,
        comment: "",
    });
    assert.deepEqual(input, {
        requestId: "req-2",
        rating: "up",
    });
    assert.ok(!("agent" in input));
    assert.ok(!("utterance" in input));
    assert.ok(!("comment" in input));
    assert.ok(!("category" in input));
});
