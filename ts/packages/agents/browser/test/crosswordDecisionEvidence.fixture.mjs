// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";

export function targetCandidates(native) {
    return Object.entries(native.questions.target.criteria)
        .filter(([id]) => id !== "no_fit" && id !== "ambiguous")
        .map(([id, evidence]) => ({ id, ...JSON.parse(evidence) }));
}

export function discoveryRegions(native) {
    const prefix = "Does this region contain crossword clues? ";
    const suffix =
        "\nFor a partial preview, choose uncertain unless clues are visible.";
    return Object.entries(native.questions).map(([id, question]) => {
        assert.ok(question.instructions.startsWith(prefix));
        assert.ok(question.instructions.endsWith(suffix));
        const evidence = JSON.parse(
            question.instructions.slice(prefix.length, -suffix.length),
        );
        assert.equal(evidence.id, id);
        return evidence;
    });
}
