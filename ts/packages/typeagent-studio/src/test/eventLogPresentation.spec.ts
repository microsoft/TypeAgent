// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import type { StudioEvent } from "@typeagent/core/events";
import {
    buildEventLogRows,
    formatEventSummary,
    formatEventTime,
    iconForEvent,
    type EventLogEntry,
} from "../eventLogPresentation.js";

function base(): Pick<StudioEvent, "schemaVersion" | "ts" | "sandboxId"> {
    return { schemaVersion: 1, ts: 0, sandboxId: "studio-default" };
}

test("buildEventLogRows returns a placeholder when there are no entries", () => {
    const rows = buildEventLogRows([]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "empty");
    assert.equal(rows[0].label, "No events yet");
    assert.equal(rows[0].hasChildren, false);
});

test("buildEventLogRows maps entries preserving order with unique ids", () => {
    const entries: EventLogEntry[] = [
        {
            seq: 2,
            event: { ...base(), type: "sandbox.start" } as StudioEvent,
        },
        {
            seq: 1,
            event: { ...base(), type: "sandbox.stop" } as StudioEvent,
        },
    ];
    const rows = buildEventLogRows(entries);
    assert.deepEqual(
        rows.map((r) => r.id),
        ["event:2", "event:1"],
    );
    assert.deepEqual(
        rows.map((r) => r.label),
        ["sandbox started", "sandbox stopped"],
    );
    assert.ok(rows.every((r) => r.kind === "event"));
    assert.equal(rows[0].contextValue, "studioEvent");
    assert.equal(rows[0].eventType, "sandbox.start");
});

test("formatEventSummary renders representative event types", () => {
    assert.equal(
        formatEventSummary({
            ...base(),
            type: "phase.end",
            phase: "translate",
            durationMs: 12,
            success: false,
        } as StudioEvent),
        "phase translate failed (12ms)",
    );
    assert.equal(
        formatEventSummary({
            ...base(),
            type: "action.selected",
            actionType: "playTrack",
            source: "grammar",
        } as StudioEvent),
        "action playTrack via grammar",
    );
    assert.equal(
        formatEventSummary({
            ...base(),
            type: "grammar.match.result",
            utterance: "play   some jazz",
            matched: true,
        } as StudioEvent),
        'grammar matched: "play some jazz"',
    );
    assert.equal(
        formatEventSummary({
            ...base(),
            type: "sandbox.agent.loaded",
            affectedAgent: "player",
        } as StudioEvent),
        "agent loaded: player",
    );
});

test("iconForEvent reflects success for executed actions", () => {
    assert.equal(
        iconForEvent({
            ...base(),
            type: "action.executed",
            actionType: "x",
            success: true,
            durationMs: 1,
        } as StudioEvent),
        "check",
    );
    assert.equal(
        iconForEvent({
            ...base(),
            type: "action.executed",
            actionType: "x",
            success: false,
            durationMs: 1,
        } as StudioEvent),
        "error",
    );
});

test("formatEventTime renders deterministic UTC HH:MM:SS", () => {
    // 1970-01-01T01:02:03Z
    assert.equal(formatEventTime(3723 * 1000), "01:02:03");
});

test("row description includes the agent when present", () => {
    const rows = buildEventLogRows([
        {
            seq: 0,
            event: {
                ...base(),
                ts: 3723 * 1000,
                type: "reasoning.step",
                stepName: "plan",
                agent: "player",
            } as StudioEvent,
        },
    ]);
    assert.equal(rows[0].description, "01:02:03 \u00b7 player");
});
