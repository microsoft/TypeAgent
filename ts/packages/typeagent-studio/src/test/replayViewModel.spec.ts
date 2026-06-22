// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import type { ActionDelta } from "@typeagent/core/replay";
import {
    toImpactRows,
    toImpactMethodNote,
    toImpactErrorLine,
    parseVersionInput,
    toSideMethodLabel,
    buildImpactFilterChips,
    filterImpactRows,
    defaultImpactFilters,
    allStatusesActive,
    impactFilterNote,
    impactEmptyState,
    allRowsEqual,
    IMPACT_FILTER_ORDER,
    type ReplayRowStatus,
} from "../webviewKit/replayViewModel.js";

function row(overrides: Partial<ActionDelta>): ActionDelta {
    return {
        utterance: "play some jazz",
        source: "in-repo",
        utteranceId: "u1",
        equal: true,
        cacheStateA: "hit",
        cacheStateB: "hit",
        collisionsA: [],
        collisionsB: [],
        latencyA: 10,
        latencyB: 12,
        requestIdA: "a",
        requestIdB: "b",
        ...overrides,
    } as ActionDelta;
}

test("toImpactRows classifies and shapes rows for the webview", () => {
    const rows = toImpactRows([
        row({ equal: true }),
        row({ equal: false, actionA: {}, actionB: {}, utteranceId: "u2" }),
        row({ equal: false, actionB: {}, utteranceId: "u3" }),
        row({ equal: false, actionA: {}, utteranceId: "u4" }),
    ]);
    assert.deepEqual(
        rows.map((r) => r.status),
        ["equal", "changed", "new-match", "lost-match"],
    );
    // Browser-neutral: no Quick Pick `$(...)` icon syntax leaks through.
    assert.ok(rows.every((r) => !r.statusLabel.includes("$(")));
    assert.equal(rows[0].resolutionA, "hit");
    assert.equal(rows[0].resolutionB, "hit");
    assert.equal(rows[0].latency, "10/12ms");
});

test("toImpactRows collapses long utterances", () => {
    const long = "x".repeat(200);
    const [r] = toImpactRows([row({ utterance: long })]);
    assert.ok(r.utterance.length <= 120);
    assert.ok(r.utterance.endsWith("\u2026"));
});

test("toImpactRows tags cache-served and grammar fall-through on the construction-cache side", () => {
    // A → HEAD (schema grammar), B → working tree (construction cache).
    const rows = toImpactRows(
        [
            row({ cacheStateA: "hit", cacheStateB: "hit" }), // B served from cache
            row({
                cacheStateA: "hit",
                cacheStateB: "miss",
                utteranceId: "u2",
            }), // B fell through to grammar
            row({
                cacheStateA: "needs-explanation",
                cacheStateB: "hit",
                utteranceId: "u3",
            }), // new match the cache resolves
        ],
        "schema-grammar",
        "construction-cache",
    );
    // The cache side spells out the source; the grammar side stays raw.
    assert.equal(rows[0].resolutionA, "hit");
    assert.equal(rows[0].resolutionB, "hit\u00b7cache");
    assert.equal(rows[1].resolutionB, "miss\u00b7grammar");
    assert.equal(rows[2].resolutionA, "needs-explanation");
    assert.equal(rows[2].resolutionB, "hit\u00b7cache");
    assert.equal(rows[0].latency, "10/12ms");
});

test("toImpactRows leaves tokens raw when neither side ran the construction cache", () => {
    const [r] = toImpactRows(
        [row({ cacheStateA: "hit", cacheStateB: "hit" })],
        "schema-grammar",
        "schema-grammar",
    );
    assert.equal(r.resolutionA, "hit");
    assert.equal(r.resolutionB, "hit");
    assert.equal(r.latency, "10/12ms");
});

test("toSideMethodLabel gives a short per-side label", () => {
    assert.equal(toSideMethodLabel("construction-cache"), "construction cache");
    assert.equal(
        toSideMethodLabel("schema-grammar"),
        "schema-enriched grammar",
    );
    assert.equal(toSideMethodLabel("static-grammar"), "static grammar");
    assert.equal(toSideMethodLabel("identity"), "identity");
});

test("toImpactMethodNote labels static-grammar but stays silent for identity", () => {
    assert.equal(toImpactMethodNote("identity"), undefined);
    const note = toImpactMethodNote("static-grammar");
    assert.ok(note);
    assert.ok(/static grammar/i.test(note!));
    // Make the caveat explicit so results aren't read as authoritative dispatch.
    assert.ok(/indicative/i.test(note!));
});

test("toImpactMethodNote explains the construction-cache method", () => {
    const note = toImpactMethodNote("construction-cache");
    assert.ok(note);
    assert.ok(/construction[- ]cache/i.test(note!));
    // The honest caveats: cache hits are faithful, the rest is indicative grammar,
    // and the cache is consulted for the working tree only.
    assert.ok(/working tree/i.test(note!));
    assert.ok(/git ref/i.test(note!));
});

test("toImpactErrorLine names the failed side and ref", () => {
    const line = toImpactErrorLine({
        kind: "version-build-failed",
        side: "B",
        ref: "HEAD~1",
        message: "Failed to compile grammar for player (side B): boom",
    });
    assert.ok(line.includes("version B"));
    assert.ok(line.includes("HEAD~1"));
    assert.ok(line.includes("boom"));
});

test("parseVersionInput treats blanks/keywords as working tree, else a git ref", () => {
    for (const blank of ["", "  ", "working tree", "WorkingTree", "."]) {
        assert.deepEqual(parseVersionInput(blank), { kind: "workingTree" });
    }
    assert.deepEqual(parseVersionInput(undefined), { kind: "workingTree" });
    assert.deepEqual(parseVersionInput("HEAD"), { kind: "git", ref: "HEAD" });
    assert.deepEqual(parseVersionInput("  HEAD~2 "), {
        kind: "git",
        ref: "HEAD~2",
    });
    assert.deepEqual(parseVersionInput("my-branch"), {
        kind: "git",
        ref: "my-branch",
    });
});

// A spread of every status for the filter helpers: 2 equal, 1 each of the
// three difference kinds.
function mixedRows() {
    return toImpactRows([
        row({ equal: true, utteranceId: "e1" }),
        row({ equal: true, utteranceId: "e2" }),
        row({ equal: false, actionA: {}, actionB: {}, utteranceId: "c1" }),
        row({ equal: false, actionB: {}, utteranceId: "n1" }),
        row({ equal: false, actionA: {}, utteranceId: "l1" }),
    ]);
}

test("buildImpactFilterChips counts each status in fixed order", () => {
    const chips = buildImpactFilterChips(mixedRows());
    assert.deepEqual(
        chips.map((c) => c.status),
        IMPACT_FILTER_ORDER,
    );
    const byStatus = new Map(chips.map((c) => [c.status, c.count]));
    assert.equal(byStatus.get("equal"), 2);
    assert.equal(byStatus.get("changed"), 1);
    assert.equal(byStatus.get("new-match"), 1);
    assert.equal(byStatus.get("lost-match"), 1);
    // Every chip carries a non-empty human label.
    assert.ok(chips.every((c) => c.label.length > 0));
});

test("defaultImpactFilters shows every status so the report opens on All", () => {
    const active = defaultImpactFilters();
    for (const status of IMPACT_FILTER_ORDER) {
        assert.ok(active.has(status));
    }
    const shown = filterImpactRows(mixedRows(), active);
    assert.equal(shown.length, mixedRows().length);
});

test("allStatusesActive is true only when nothing with rows is hidden", () => {
    const chips = buildImpactFilterChips(mixedRows());
    assert.ok(allStatusesActive(chips, defaultImpactFilters()));
    const noEqual = new Set<ReplayRowStatus>(
        IMPACT_FILTER_ORDER.filter((s) => s !== "equal"),
    );
    // equal has rows in the fixture, so hiding it drops out of the All view.
    assert.ok(!allStatusesActive(chips, noEqual));
});

test("allStatusesActive ignores statuses with no rows", () => {
    // Only equal rows: the empty difference buckets must not block the All view.
    const chips = buildImpactFilterChips(
        toImpactRows([
            row({ equal: true, utteranceId: "e1" }),
            row({ equal: true, utteranceId: "e2" }),
        ]),
    );
    assert.ok(allStatusesActive(chips, new Set<ReplayRowStatus>(["equal"])));
});

test("filterImpactRows keeps only rows whose status is active", () => {
    const active = new Set<ReplayRowStatus>(["lost-match"]);
    const shown = filterImpactRows(mixedRows(), active);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].status, "lost-match");
});

test("impactFilterNote describes the non-empty hidden statuses", () => {
    const chips = buildImpactFilterChips(mixedRows());
    // Hide equal explicitly (the All default shows everything).
    const differences = new Set<ReplayRowStatus>([
        "changed",
        "new-match",
        "lost-match",
    ]);
    const note = impactFilterNote(chips, differences);
    // The 2 equal rows are hidden.
    assert.ok(note);
    assert.ok(/2 rows hidden/.test(note!));
    assert.ok(/equal/.test(note!));
});

test("impactFilterNote is silent when nothing with rows is hidden", () => {
    const chips = buildImpactFilterChips(mixedRows());
    const all = new Set<ReplayRowStatus>(IMPACT_FILTER_ORDER);
    assert.equal(impactFilterNote(chips, all), undefined);
});

test("allRowsEqual is true only when every row is equal", () => {
    assert.ok(
        allRowsEqual(
            toImpactRows([
                row({ equal: true, utteranceId: "e1" }),
                row({ equal: true, utteranceId: "e2" }),
            ]),
        ),
    );
    assert.ok(!allRowsEqual(mixedRows()));
    // An empty set is not "all equal" — there's simply nothing to compare.
    assert.ok(!allRowsEqual([]));
});

test("impactEmptyState gives first-run guidance", () => {
    const state = impactEmptyState();
    assert.ok(state.title.length > 0);
    assert.ok(/base/i.test(state.hint));
    assert.ok(/compare/i.test(state.hint));
});
