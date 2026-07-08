// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The Impact Report's default likely-regression predicate.
 *
 * A replay compares how each corpus utterance resolves on two versions of an
 * agent (side A = Base, side B = Compare). Structural classification alone
 * (equal / changed / new-match / lost-match) says whether the resolved action
 * changed; this predicate adds the value judgment on top: is a change *likely a
 * regression* (red) or *benign/an improvement* (green)?
 *
 * The judgment is made from the shape of the delta so it works on a fresh edit
 * with no human feedback yet (the common case when hunting for a regression).
 * Explicit feedback on side B, when present, overrides the structural guess: a
 * thumbs-down means the new result is bad, a thumbs-up means it is accepted.
 * Feedback is observation-scoped — it is supplied only when side B reproduced
 * the action the rating was recorded against, so a stale rating for a
 * now-different action never drives the verdict. Side-A feedback is not used —
 * a prior approval of the old result does not by itself make a change a
 * regression.
 */

import { actionsEqual } from "./engine.js";
import type { FeedbackLabel } from "../corpus/types.js";

export type RegressionVerdict =
    | "regression"
    | "improvement"
    | "benign"
    | "neutral";

/** The minimal row surface the predicate reads; a superset {@link ActionDelta}
 *  satisfies it, so real replay rows can be classified directly. */
export interface RegressionRow {
    actionA?: unknown;
    actionB?: unknown;
    equal: boolean;
    /** Ratings are supplied only when the side reproduced the action the rating
     *  was recorded against, so the predicate can trust them directly. */
    feedbackA?: FeedbackLabel;
    feedbackB?: FeedbackLabel;
}

interface ActionShape {
    actionName?: unknown;
    parameters?: unknown;
}

function present(action: unknown): action is ActionShape {
    return typeof action === "object" && action !== null;
}

function paramsOf(action: ActionShape): Record<string, unknown> {
    const params = action.parameters;
    return present(params) ? (params as Record<string, unknown>) : {};
}

/**
 * Classify a changed replay row as a likely regression, improvement, or benign
 * change; unchanged rows are `neutral`. Green (not flagged) = improvement or
 * benign. Parameter comparison reuses {@link actionsEqual}, so key order, array
 * order, and null/undefined/missing differences are treated as equal.
 */
export function likelyRegression(row: RegressionRow): RegressionVerdict {
    if (row.equal) {
        return "neutral";
    }

    if (row.feedbackB?.rating === "down") {
        return "regression";
    }
    if (row.feedbackB?.rating === "up") {
        return "benign";
    }

    const hasA = present(row.actionA);
    const hasB = present(row.actionB);
    if (hasA && !hasB) {
        return "regression"; // a previously matched utterance no longer resolves
    }
    if (!hasA && hasB) {
        return "improvement"; // a previously unmatched utterance now resolves
    }
    if (!hasA && !hasB) {
        return "benign"; // neither side resolved; nothing meaningful changed
    }

    const a = row.actionA as ActionShape;
    const b = row.actionB as ActionShape;
    if (!actionsEqual(a.actionName, b.actionName)) {
        return "regression"; // the utterance now maps to a different action
    }

    const paramsA = paramsOf(a);
    const paramsB = paramsOf(b);
    for (const key of Object.keys(paramsA)) {
        const valueA = paramsA[key];
        if (valueA === undefined || valueA === null) {
            continue; // an absent value on A cannot be lost
        }
        const valueB = paramsB[key];
        if (
            valueB === undefined ||
            valueB === null ||
            !actionsEqual(valueA, valueB)
        ) {
            return "regression"; // side A carried data that B dropped or changed
        }
    }

    return "benign"; // same action, side B only adds parameters
}
