// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import type { CollisionDetectedEvent } from "@typeagent/core/events";
import {
    buildCollisionChildRows,
    buildCollisionRows,
    buildSkippedRows,
    formatCollisionSummary,
    formatParticipants,
    iconForCollisionKind,
    type CollisionEntry,
} from "../collisionsPresentation.js";

function collision(
    partial: Partial<CollisionDetectedEvent> = {},
): CollisionDetectedEvent {
    return {
        schemaVersion: 1,
        type: "collision.detected",
        ts: 1000,
        sandboxId: "studio-default",
        kind: "overlap",
        detectionPoint: "grammar-edit",
        participants: [
            {
                agent: "player",
                actionType: "player.play",
                file: "player.agr",
                range: [3, 5],
            },
            {
                agent: "music",
                actionType: "music.play",
                file: "music.agr",
                range: [7, 9],
            },
        ],
        ...partial,
    };
}

function entry(seq: number, event: CollisionDetectedEvent): CollisionEntry {
    return { seq, event };
}

test("iconForCollisionKind maps every kind", () => {
    assert.equal(iconForCollisionKind("overlap"), "git-merge");
    assert.equal(iconForCollisionKind("shadow"), "eye-closed");
    assert.equal(iconForCollisionKind("ambiguity"), "question");
});

test("formatParticipants joins action types and handles empties", () => {
    assert.equal(
        formatParticipants(collision()),
        "player.play \u2194 music.play",
    );
    assert.equal(
        formatParticipants(collision({ participants: [] })),
        "(no participants)",
    );
});

test("formatCollisionSummary prefixes the kind", () => {
    assert.equal(
        formatCollisionSummary(collision()),
        "overlap: player.play \u2194 music.play",
    );
});

test("buildCollisionRows returns a placeholder when empty", () => {
    const rows = buildCollisionRows([]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "empty");
    assert.equal(rows[0].icon, "check");
    assert.equal(rows[0].hasChildren, false);
});

test("buildCollisionRows maps each collision with detection point and children", () => {
    const rows = buildCollisionRows([
        entry(0, collision()),
        entry(1, collision({ kind: "shadow", participants: [] })),
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, "collision:0");
    assert.equal(rows[0].description, "grammar-edit");
    assert.equal(rows[0].icon, "git-merge");
    assert.equal(rows[0].hasChildren, true);
    // No participants and no exemplars -> not expandable.
    assert.equal(rows[1].hasChildren, false);
});

test("buildCollisionRows marks exemplar-only collisions expandable", () => {
    const rows = buildCollisionRows([
        entry(
            0,
            collision({ participants: [], exemplarUtterances: ["play it"] }),
        ),
    ]);
    assert.equal(rows[0].hasChildren, true);
});

test("buildCollisionChildRows lists participants then exemplars", () => {
    const rows = buildCollisionChildRows(
        entry(2, collision({ exemplarUtterances: ["play the song"] })),
    );
    assert.equal(rows.length, 3);
    assert.equal(rows[0].kind, "participant");
    assert.equal(rows[0].id, "collision:2:participant:0");
    assert.equal(rows[0].label, "player.play");
    assert.equal(rows[0].description, "player.agr:3");
    assert.equal(rows[2].kind, "exemplar");
    assert.equal(rows[2].id, "collision:2:exemplar:0");
    assert.equal(rows[2].label, "play the song");
});

test("participant rows expose openPath for navigable source files", () => {
    const rows = buildCollisionChildRows(entry(4, collision()));
    assert.equal(rows[0].openPath, "player.agr");
    assert.equal(rows[1].openPath, "music.agr");
});

test("participant rows omit openPath for placeholder source files", () => {
    const rows = buildCollisionChildRows(
        entry(
            5,
            collision({
                participants: [
                    {
                        agent: "player",
                        actionType: "player.play",
                        file: "<grammar>",
                        range: [1, 1],
                    },
                ],
            }),
        ),
    );
    assert.equal(rows[0].openPath, undefined);
});

test("buildCollisionRows prepends a skipped-group row when scan reported skips", () => {
    const rows = buildCollisionRows(
        [entry(0, collision())],
        [
            { schemaName: "code", reason: "no-grammar" },
            {
                schemaName: "player",
                reason: "compile-error",
                error: "unknown variable t",
            },
        ],
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, "skipped-group");
    assert.equal(rows[0].id, "collision:skipped");
    assert.equal(rows[0].label, "Skipped (2)");
    assert.equal(rows[0].hasChildren, true);
    assert.equal(rows[1].kind, "collision");
});

test("buildCollisionRows skipped-group appears alongside the empty placeholder", () => {
    const rows = buildCollisionRows(
        [],
        [{ schemaName: "code", reason: "no-grammar" }],
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, "skipped-group");
    assert.equal(rows[1].kind, "empty");
});

test("buildSkippedRows formats reason and surfaces error detail in description", () => {
    const rows = buildSkippedRows([
        { schemaName: "code", reason: "no-grammar" },
        {
            schemaName: "player",
            reason: "compile-error",
            error: "unknown variable t",
        },
        {
            schemaName: "crossword",
            reason: "parse-error",
            error: "unexpected token",
        },
    ]);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].id, "collision:skipped:0");
    assert.equal(rows[0].label, "code");
    assert.equal(rows[0].description, "no grammar");
    assert.equal(rows[0].icon, "circle-outline");
    assert.equal(rows[1].description, "compile error — unknown variable t");
    assert.equal(rows[1].icon, "error");
    assert.equal(rows[1].tooltip?.includes("Detail: unknown variable t"), true);
    assert.equal(rows[2].icon, "warning");
});

test("buildSkippedRows labels grammar-not-built distinctly from no-grammar", () => {
    const rows = buildSkippedRows([
        { schemaName: "code", agentName: "code", reason: "grammar-not-built" },
        { schemaName: "chat", agentName: "chat", reason: "no-grammar" },
    ]);
    assert.equal(rows[0].description, "grammar not built");
    assert.equal(rows[0].icon, "tools");
    assert.equal(rows[1].description, "no grammar");
    assert.equal(rows[1].icon, "circle-outline");
});

test("buildSkippedRows annotates sub-schemas with their owning agent", () => {
    const rows = buildSkippedRows([
        {
            schemaName: "crossword",
            agentName: "browser",
            reason: "compile-error",
            error: "unknown variable __opt_v_0",
        },
        { schemaName: "code", agentName: "code", reason: "no-grammar" },
    ]);
    // Sub-schema name differs from agent -> show "(browser)" suffix.
    assert.equal(rows[0].label, "crossword (browser)");
    assert.equal(rows[0].tooltip?.includes("Agent: browser"), true);
    // Agent name equals schema name -> no redundant suffix.
    assert.equal(rows[1].label, "code");
    assert.equal(rows[1].tooltip?.includes("Agent:"), false);
});
