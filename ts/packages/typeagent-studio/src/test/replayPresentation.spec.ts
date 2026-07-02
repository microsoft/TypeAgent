// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import type { ActionDelta, ReplaySummary } from "@typeagent/core/replay";
import {
    buildReplayRowViews,
    classifyReplayRow,
    formatReplayRow,
    formatReplaySummaryLine,
    replayHasDifferences,
} from "../replayPresentation.js";

function row(partial: Partial<ActionDelta>): ActionDelta {
    return {
        utterance: "play jazz",
        source: "in-repo",
        utteranceId: "u1",
        equal: true,
        cacheStateA: "hit",
        cacheStateB: "hit",
        collisionsA: [],
        collisionsB: [],
        latencyA: 1,
        latencyB: 2,
        requestIdA: "u1:A",
        requestIdB: "u1:B",
        ...partial,
    };
}

function summary(partial: Partial<ReplaySummary>): ReplaySummary {
    return {
        runId: "run-1",
        agent: "player",
        versionA: { kind: "workingTree" },
        versionB: { kind: "workingTree" },
        corpusSize: 0,
        rowCount: 0,
        equalCount: 0,
        changedCount: 0,
        newMatchCount: 0,
        lostMatchCount: 0,
        collisionDelta: 0,
        duration: 0,
        missPolicy: "needs-explanation",
        ...partial,
    };
}

test("classifyReplayRow distinguishes the four outcomes", () => {
    assert.equal(
        classifyReplayRow(row({ equal: true, actionA: {}, actionB: {} })),
        "equal",
    );
    assert.equal(
        classifyReplayRow(
            row({ equal: false, actionA: { a: 1 }, actionB: { a: 2 } }),
        ),
        "changed",
    );
    assert.equal(
        classifyReplayRow(
            row({ equal: false, actionA: undefined, actionB: { a: 2 } }),
        ),
        "new-match",
    );
    assert.equal(
        classifyReplayRow(
            row({ equal: false, actionA: { a: 1 }, actionB: undefined }),
        ),
        "lost-match",
    );
});

test("formatReplayRow includes an icon, truncated utterance, and cache states", () => {
    const view = formatReplayRow(
        row({
            utterance: "   play   some    jazz   ",
            cacheStateA: "hit",
            cacheStateB: "needs-explanation",
            latencyA: 3,
            latencyB: 4,
        }),
    );
    assert.equal(view.status, "equal");
    assert.equal(view.label, "$(check) play some jazz");
    assert.match(view.detail, /A:hit B:needs-explanation/);
    assert.match(view.detail, /3\/4ms/);
});

test("buildReplayRowViews maps every row", () => {
    const views = buildReplayRowViews([
        row({ utteranceId: "a" }),
        row({
            utteranceId: "b",
            equal: false,
            actionA: {},
            actionB: undefined,
        }),
    ]);
    assert.equal(views.length, 2);
    assert.equal(views[1].status, "lost-match");
});

test("formatReplaySummaryLine omits collision delta when zero", () => {
    const line = formatReplaySummaryLine(
        summary({ rowCount: 3, equalCount: 3, duration: 12 }),
    );
    assert.match(line, /player/);
    assert.match(line, /3 rows/);
    assert.ok(!line.includes("collision"));
    assert.match(line, /12ms/);
});

test("formatReplaySummaryLine shows signed collision delta", () => {
    const line = formatReplaySummaryLine(
        summary({ rowCount: 1, collisionDelta: 2 }),
    );
    assert.match(line, /\+2 collision/);
});

test("replayHasDifferences reflects changed/new/lost counts", () => {
    assert.equal(replayHasDifferences(summary({ equalCount: 5 })), false);
    assert.equal(replayHasDifferences(summary({ changedCount: 1 })), true);
    assert.equal(replayHasDifferences(summary({ newMatchCount: 1 })), true);
    assert.equal(replayHasDifferences(summary({ lostMatchCount: 1 })), true);
});
