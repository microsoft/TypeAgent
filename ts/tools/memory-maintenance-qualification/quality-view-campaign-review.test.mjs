// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { identity } from "./quality-contract.mjs";
import {
    validateGroupSplit,
    validateReviewProtocol,
} from "./quality-view-campaign-review.mjs";
import {
    validateTaskGold,
    validateTaskLabels,
    validateTaskContext,
    taskScore,
} from "./quality-view-campaign-tasks.mjs";
import {
    captureProviderEvents,
    scheduledCheckpoints,
} from "./quality-view-campaign-capture.mjs";

test("whole-source/project splitting prevents checkpoint and transitive leakage", () => {
    const inventory = [
        {
            id: "a0",
            clusters: {
                source: ["s1"],
                project: ["a"],
                topic: [],
                meeting: [],
            },
        },
        {
            id: "a1",
            clusters: {
                source: ["s2"],
                project: ["a"],
                topic: [],
                meeting: [],
            },
        },
        {
            id: "b0",
            clusters: {
                source: ["s2"],
                project: ["b"],
                topic: [],
                meeting: [],
            },
        },
    ];
    const split = inventory.map(({ id }) => ({ id, phase: "development" }));
    assert.equal(typeof validateGroupSplit(inventory, split), "string");
    split[2].phase = "confirmation";
    assert.throws(() => validateGroupSplit(inventory, split), /crosses split/);
});

function protocolFixture() {
    const rubricHash = identity("reviewed rubric");
    const calibration = {
        status: "approved-independent-human-review",
        rubricHash,
        reviewers: ["human-1", "human-2"],
        minimumAgreement: 1,
        reviewedAt: "2026-01-01T10:00:00Z",
        judgments: [
            {
                id: "j1",
                artifactHash: identity("actual sample"),
                votes: [
                    { reviewer: "human-1", verdict: "supported" },
                    { reviewer: "human-2", verdict: "supported" },
                ],
                resolution: "Independent votes agree",
            },
        ],
    };
    const run = {
        startedAt: "2026-01-02T10:00:00Z",
        arms: [{ id: "candidate", promptHash: identity("prompt") }],
    };
    const protocol = {
        schemaVersion: 1,
        status: "approved-independent-human-review",
        author: "author",
        reviewer: "owner",
        rubricHash,
        calibration,
        reviewedAt: "2026-01-01T11:00:00Z",
        candidateHashes: run.arms.map(identity),
    };
    const campaign = {
        phase: "confirmation",
        thresholds: {
            rubricHash,
            calibrationRecordHash: identity(calibration),
            registeredAt: "2026-01-01T12:00:00Z",
        },
    };
    return { protocol, run, campaign };
}

test("confirmation requires actual independent calibration and frozen candidates before execution", () => {
    const { protocol, run, campaign } = protocolFixture();
    assert.equal(validateReviewProtocol(protocol, campaign, run).agreement, 1);
    run.arms[0].promptHash = identity("changed after registration");
    assert.throws(
        () => validateReviewProtocol(protocol, campaign, run),
        /candidates differ/,
    );
    protocol.status = "pending-independent-human-review";
    assert.throws(
        () => validateReviewProtocol(protocol, campaign, run),
        /approval pending/,
    );
});

test("calibration disagreements, missing votes and post-start registration do not pass", () => {
    const { protocol, run, campaign } = protocolFixture();
    protocol.calibration.judgments[0].votes[1].verdict = "unsupported";
    assert.throws(
        () => validateReviewProtocol(protocol, campaign, run),
        /agreement criterion/,
    );
    protocol.calibration.judgments[0].votes.pop();
    assert.throws(
        () => validateReviewProtocol(protocol, campaign, run),
        /each independent judgment/,
    );
    const f = protocolFixture();
    f.campaign.thresholds.registeredAt = f.run.startedAt;
    assert.throws(
        () => validateReviewProtocol(f.protocol, f.campaign, f.run),
        /before confirmation/,
    );
});

test("task gold delegates original-revision witness checks and forbids invented topic judgments", () => {
    const task = {
        id: "pair",
        metric: "topicFalseMerge",
        subject: "service/desktop",
        expected: "different",
        requirement: "Keep scopes separate",
        critical: true,
        witnesses: [{}],
    };
    let checked = 0;
    validateTaskGold([task], {}, new Map(), () => checked++);
    assert.equal(checked, 1);
    assert.throws(
        () =>
            validateTaskGold([task], {}, new Map(), () => {
                throw new Error("revision mismatch");
            }),
        /revision mismatch/,
    );
    task.expected = "same";
    assert.throws(
        () => validateTaskGold([task], {}, new Map(), () => {}),
        /metric\/judgment mismatch/,
    );
});

test("ordering, obsolete claims and protected edits are checked against exact actual output", () => {
    const row = {
        saved: "protected note. Blocked trial. History.",
        rendered: "Blocked trial. History. protected note.",
    };
    const evidence = [{ artifact: "rendered", quote: "Blocked trial." }];
    const ordering = { id: "order", metric: "issueOrdering" };
    const label = {
        id: "order",
        correct: true,
        rationale: "Blocker precedes history",
        beforeQuote: "Blocked trial.",
        afterQuote: "History.",
        evidence,
    };
    validateTaskLabels([ordering], [label], row);
    assert.throws(
        () =>
            validateTaskLabels(
                [ordering],
                [
                    {
                        ...label,
                        beforeQuote: "History.",
                        afterQuote: "Blocked trial.",
                    },
                ],
                row,
            ),
        /contradicts/,
    );
    const removal = {
        id: "remove",
        metric: "sourceForgetting",
        expected: "absent",
        obsoleteQuote: "Blocked trial.",
    };
    assert.throws(
        () => validateTaskLabels([removal], [{ ...label, id: "remove" }], row),
        /remains/,
    );
    const edit = {
        id: "edit",
        metric: "humanEditGuard",
        protectedQuote: "protected note.",
        protectedSavedQuote: "protected note.",
    };
    validateTaskLabels([edit], [{ ...label, id: "edit" }], row);
    assert.throws(
        () =>
            validateTaskLabels([edit], [{ ...label, id: "edit" }], {
                ...row,
                saved: "lost edit",
            }),
        /not preserved/,
    );
});

test("maintenance scoring binds predecessor artifacts and actual operation receipts", () => {
    const previous = {
        id: "p",
        caseId: "checkpoint-0",
        arm: "a",
        generation: 1,
        hashes: {
            savedHash: identity("before"),
            renderedHash: identity("before rendered"),
        },
    };
    const receipt = JSON.stringify({
        caseId: "checkpoint-1",
        kind: "source-removal",
        sourceId: "removed",
        state: "complete",
    });
    const row = {
        id: "n",
        caseId: "checkpoint-1",
        arm: "a",
        generation: 1,
        selectedEvidence: [],
        taskReceipts: [receipt],
        status: "ok",
        taskBindings: [
            {
                id: "remove",
                previousSavedHash: previous.hashes.savedHash,
                previousRenderedHash: previous.hashes.renderedHash,
                operationReceiptHash: identity(receipt),
            },
        ],
    };
    const task = {
        id: "remove",
        metric: "sourceForgetting",
        previousCheckpointId: "checkpoint-0",
        removedSourceId: "removed",
    };
    const rows = new Map([
        ["p", previous],
        ["n", row],
    ]);
    validateTaskContext([task], row, rows);
    row.selectedEvidence.push({ sourceId: "removed" });
    assert.throws(
        () => validateTaskContext([task], row, rows),
        /remains selected/,
    );
    row.selectedEvidence = [];
    row.taskReceipts = [];
    assert.throws(
        () => validateTaskContext([task], row, rows),
        /Missing exact/,
    );
    row.taskBindings[0].previousSavedHash = identity("different predecessor");
    assert.throws(() => validateTaskContext([task], row, rows), /predecessor/);
});

test("shared maintenance gold accepts distinct arm/generation predecessor bindings and rejects cross-wiring", () => {
    const task = {
        id: "correction",
        metric: "correctionUptake",
        previousCheckpointId: "before",
    };
    const rows = new Map();
    for (const arm of ["a", "b"]) {
        for (const generation of [1, 2]) {
            const previous = {
                id: `${arm}-${generation}-before`,
                caseId: "before",
                arm,
                generation,
                hashes: {
                    savedHash: identity(`${arm}-${generation}`),
                    renderedHash: identity(`render-${arm}-${generation}`),
                },
            };
            const current = {
                id: `${arm}-${generation}-after`,
                caseId: "after",
                arm,
                generation,
                status: "ok",
                taskBindings: [
                    {
                        id: task.id,
                        previousSavedHash: previous.hashes.savedHash,
                        previousRenderedHash: previous.hashes.renderedHash,
                    },
                ],
            };
            rows.set(previous.id, previous);
            rows.set(current.id, current);
        }
    }
    for (const row of rows.values())
        if (row.caseId === "after") validateTaskContext([task], row, rows);
    const changed = structuredClone(rows.get("b-2-after"));
    changed.taskBindings = rows.get("a-1-after").taskBindings;
    assert.throws(
        () => validateTaskContext([task], changed, rows),
        /predecessor/,
    );
});

test("outputless failures retain unknown task outcomes without invented quotes or success credit", () => {
    const task = {
        id: "admit",
        metric: "topicAdmission",
        expected: "admitted",
    };
    const row = { status: "failed", saved: null, rendered: null };
    const label = {
        id: "admit",
        correct: null,
        observed: "uncertain",
        rationale: "Provider failed before output",
        evidence: [],
    };
    validateTaskLabels([task], [label], row);
    assert.equal(
        taskScore([task], [label], "topicAdmission", false).denominator,
        1,
    );
    assert.equal(
        taskScore([task], [label], "topicAdmission", false).numerator,
        0,
    );
    assert.throws(
        () => validateTaskLabels([task], [{ ...label, correct: true }], row),
        /Outputless/,
    );
    assert.throws(
        () =>
            validateTaskLabels(
                [task],
                [
                    {
                        ...label,
                        evidence: [{ artifact: "saved", quote: "invented" }],
                    },
                ],
                row,
            ),
        /Outputless/,
    );
});

test("topic errors are error rates, uncertain judgments and absent tasks stay unknown", () => {
    const tasks = [
        { id: "pair", metric: "topicFalseMerge", expected: "different" },
    ];
    const label = {
        id: "pair",
        correct: false,
        observed: "same",
        rationale: "Merged separate scopes",
        evidence: [{ artifact: "rendered", quote: "combined" }],
    };
    validateTaskLabels(tasks, [label], {
        rendered: "combined",
        saved: "combined",
    });
    assert.equal(taskScore(tasks, [label], "topicFalseMerge", true).value, 1);
    assert.equal(
        taskScore(
            tasks,
            [{ ...label, observed: "uncertain" }],
            "topicFalseMerge",
            true,
        ).denominator,
        null,
    );
    assert.equal(taskScore([], [], "correctionUptake", true).value, null);
    assert.equal(
        taskScore(
            [{ id: "c", metric: "correctionUptake" }],
            [],
            "correctionUptake",
            false,
        ).value,
        0,
    );
});

test("scheduled failures and missing checkpoints are retained; unscheduled outcomes are rejected", () => {
    const frozen = {
        schedule: [{ id: "a", scenario: "a", kind: "wiki", checkpoints: 3 }],
    };
    const slots = scheduledCheckpoints(frozen, [
        {
            caseId: "a",
            checkpoints: [
                { checkpoint: 0, status: "saved" },
                { checkpoint: 1, status: "failed", error: "provider rejected" },
            ],
        },
    ]);
    assert.deepEqual(
        slots.map((slot) => slot.status),
        ["saved", "failed", "missing"],
    );
    assert.match(slots[1].reason, /provider rejected/);
    assert.throws(
        () => scheduledCheckpoints(frozen, [{ caseId: "b" }]),
        /Unscheduled/,
    );
});

test("actual request capture does not promote inspections; failed usage remains unknown", () => {
    const events = [
        {
            ordinal: 1,
            status: "complete",
            startedAt: "2026-01-01T10:01:00Z",
            actualSerializedRequest:
                '{"messages":[{"content":"original evidence"}],"temperature":1}',
            usage: { total_tokens: 12 },
            providerModel: "reported-model",
            latencyMs: 42,
        },
        {
            ordinal: 2,
            status: "failed",
            startedAt: "2026-01-01T10:03:00Z",
            inspectedRequest: { serializedRequest: "not the wire" },
        },
    ];
    const captured = captureProviderEvents(events, [
        {
            checkpoint: 0,
            createdAt: "2026-01-01T10:00:00Z",
            updatedAt: "2026-01-01T10:02:00Z",
        },
    ]);
    assert.equal(
        captured[0].requestHash,
        identity(events[0].actualSerializedRequest),
    );
    assert.equal(captured[0].checkpoint, 0);
    assert.equal(captured[1].actualSerializedRequest, null);
    assert.equal(captured[1].checkpoint, null);
    assert.equal(captured[1].telemetry.tokens, null);
    assert.equal(captured[1].telemetry.calls, 1);
    assert.throws(
        () => captureProviderEvents([events[0], events[0]], []),
        /ordinals/,
    );
});
