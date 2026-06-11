// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { FeedbackCategory, FeedbackRating } from "@typeagent/core/events";
import type { FeedbackRecordInput } from "@typeagent/core/feedback";

export interface FeedbackRatingChoice {
    label: string;
    value: FeedbackRating;
}

export interface FeedbackCategoryChoice {
    label: string;
    value: FeedbackCategory;
}

/** Rating options offered by the "Record feedback" quick pick. */
export const FEEDBACK_RATING_CHOICES: readonly FeedbackRatingChoice[] = [
    { label: "$(thumbsup) Helpful", value: "up" },
    { label: "$(thumbsdown) Not helpful", value: "down" },
];

/** Category options offered when the rating is a thumbs-down. */
export const FEEDBACK_CATEGORY_CHOICES: readonly FeedbackCategoryChoice[] = [
    { label: "Wrong agent", value: "wrong-agent" },
    { label: "Didn't understand", value: "didnt-understand" },
    { label: "Bad response", value: "bad-response" },
    { label: "Other", value: "other" },
];

export interface FeedbackFormFields {
    requestId: string;
    rating: FeedbackRating;
    agent?: string;
    utterance?: string;
    comment?: string;
    category?: FeedbackCategory;
}

/**
 * Assemble a `FeedbackRecordInput` from collected form fields. String fields
 * are trimmed; blank values are omitted so optional metadata is only present
 * when the user actually supplied it.
 */
export function buildFeedbackRecordInput(
    fields: FeedbackFormFields,
): FeedbackRecordInput {
    const input: FeedbackRecordInput = {
        requestId: fields.requestId,
        rating: fields.rating,
    };
    const agent = clean(fields.agent);
    if (agent !== undefined) {
        input.agent = agent;
    }
    const utterance = clean(fields.utterance);
    if (utterance !== undefined) {
        input.utterance = utterance;
    }
    const comment = clean(fields.comment);
    if (comment !== undefined) {
        input.comment = comment;
    }
    if (fields.category !== undefined) {
        input.category = fields.category;
    }
    return input;
}

function clean(value: string | undefined): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
}
