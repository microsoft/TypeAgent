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
    narrowVersionSpec,
    coerceVersionSpec,
    formatVersionProvenance,
    formatProvenanceLine,
    stableStringify,
    toActionDiff,
    toSideMethodLabel,
    buildImpactFilterChips,
    visibleImpactRows,
    toggleFilterKey,
    allRowIds,
    allRowsVisible,
    allRowsHidden,
    rowMatchesFilterKey,
    rowMatchesSearch,
    sortImpactRowsByVerdict,
    sortImpactRows,
    hiddenRowsNote,
    summarizeVerdicts,
    toVerdictBanner,
    impactEmptyState,
    allRowsEqual,
    IMPACT_FILTER_ORDER,
    toFidelityMatrix,
} from "../webviewKit/replayViewModel.js";
import type { SideFidelity } from "@typeagent/core/runtime";

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

test("narrowVersionSpec validates an untrusted spec object", () => {
    assert.deepEqual(narrowVersionSpec({ kind: "workingTree" }), {
        kind: "workingTree",
    });
    assert.deepEqual(narrowVersionSpec({ kind: "git", ref: "HEAD" }), {
        kind: "git",
        ref: "HEAD",
    });
    // Whitespace-only / empty / wrong-typed refs are rejected.
    assert.equal(narrowVersionSpec({ kind: "git", ref: "" }), undefined);
    assert.equal(narrowVersionSpec({ kind: "git", ref: "   " }), undefined);
    assert.equal(narrowVersionSpec({ kind: "git", ref: 5 }), undefined);
    assert.equal(narrowVersionSpec({ kind: "bogus" }), undefined);
    assert.equal(narrowVersionSpec(undefined), undefined);
    assert.equal(narrowVersionSpec("HEAD"), undefined);
    // A valid ref is trimmed.
    assert.deepEqual(narrowVersionSpec({ kind: "git", ref: " v1 " }), {
        kind: "git",
        ref: "v1",
    });
});

test("coerceVersionSpec accepts typed specs, strings, else working tree", () => {
    // Typed spec from a picker selection.
    assert.deepEqual(coerceVersionSpec({ kind: "git", ref: "HEAD" }), {
        kind: "git",
        ref: "HEAD",
    });
    // Raw string falls back to parseVersionInput.
    assert.deepEqual(coerceVersionSpec("my-branch"), {
        kind: "git",
        ref: "my-branch",
    });
    assert.deepEqual(coerceVersionSpec("working tree"), {
        kind: "workingTree",
    });
    // A malformed object defaults to the working tree rather than throwing.
    assert.deepEqual(coerceVersionSpec({ kind: "git", ref: "" }), {
        kind: "workingTree",
    });
    assert.deepEqual(coerceVersionSpec(null), { kind: "workingTree" });
    assert.deepEqual(coerceVersionSpec(42), { kind: "workingTree" });
});

test("formatVersionProvenance / formatProvenanceLine summarise a run", () => {
    assert.equal(
        formatVersionProvenance({
            label: "HEAD (main)",
            workingTree: false,
            sha: "a1b2c3d",
        }),
        "HEAD (main) @ a1b2c3d",
    );
    assert.equal(
        formatVersionProvenance({ label: "HEAD", workingTree: false }),
        "HEAD",
    );
    assert.equal(
        formatVersionProvenance({
            label: "working tree",
            workingTree: true,
            sha: "a1b2c3d",
        }),
        "working tree (on a1b2c3d)",
    );
    assert.equal(
        formatProvenanceLine({
            a: { label: "HEAD (main)", workingTree: false, sha: "a1b2c3d" },
            b: { label: "working tree", workingTree: true, sha: "a1b2c3d" },
            runAt: 0,
        }),
        "Ran HEAD (main) @ a1b2c3d \u2192 working tree (on a1b2c3d)",
    );
});

test("stableStringify sorts object keys so reorders aren't diffed", () => {
    assert.equal(
        stableStringify({ b: 1, a: { d: 2, c: 3 } }),
        stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
});

test("toActionDiff marks identical actions regardless of key order", () => {
    const diff = toActionDiff(
        row({
            equal: true,
            actionA: { name: "play", value: 1 },
            actionB: { value: 1, name: "play" },
        }),
    );
    assert.equal(diff.identical, true);
    assert.equal(diff.onlyA, false);
    assert.equal(diff.onlyB, false);
    assert.equal(diff.addedCount, 0);
    assert.equal(diff.removedCount, 0);
    assert.ok(diff.lines.every((l) => l.kind === "context"));
});

test("toActionDiff produces added/removed lines for a changed action", () => {
    const diff = toActionDiff(
        row({
            equal: false,
            actionA: { name: "play", track: "despacito" },
            actionB: { name: "play", track: "bohemian" },
        }),
    );
    assert.equal(diff.identical, false);
    assert.ok(diff.addedCount >= 1);
    assert.ok(diff.removedCount >= 1);
    // The unchanged "name" line stays as context.
    assert.ok(
        diff.lines.some(
            (l) => l.kind === "context" && l.text.includes('"name"'),
        ),
    );
    assert.ok(
        diff.lines.some(
            (l) => l.kind === "removed" && l.text.includes("despacito"),
        ),
    );
    assert.ok(
        diff.lines.some(
            (l) => l.kind === "added" && l.text.includes("bohemian"),
        ),
    );
});

test("toActionDiff flags a new match (no action on A)", () => {
    const diff = toActionDiff(row({ equal: false, actionB: { name: "play" } }));
    assert.equal(diff.onlyB, true);
    assert.equal(diff.onlyA, false);
    assert.equal(diff.identical, false);
    // A side renders the "(no action)" placeholder as a removed line.
    assert.ok(
        diff.lines.some(
            (l) => l.kind === "removed" && l.text.includes("(no action)"),
        ),
    );
});

test("toActionDiff flags a lost match (no action on B)", () => {
    const diff = toActionDiff(row({ equal: false, actionA: { name: "play" } }));
    assert.equal(diff.onlyA, true);
    assert.equal(diff.onlyB, false);
    assert.ok(
        diff.lines.some(
            (l) => l.kind === "added" && l.text.includes("(no action)"),
        ),
    );
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

test("buildImpactFilterChips counts each key in fixed order with live counts", () => {
    const chips = buildImpactFilterChips(mixedRows(), new Set());
    assert.deepEqual(
        chips.map((c) => c.key),
        IMPACT_FILTER_ORDER,
    );
    const byKey = new Map(chips.map((c) => [c.key, c]));
    // With nothing hidden, count === total for every key.
    assert.equal(byKey.get("regression")?.count, 1);
    assert.equal(byKey.get("improvement")?.count, 1);
    assert.equal(byKey.get("benign")?.count, 1);
    assert.equal(byKey.get("changed")?.count, 1);
    assert.equal(byKey.get("new-match")?.count, 1);
    assert.equal(byKey.get("lost-match")?.count, 1);
    // Merged equal/neutral bucket.
    assert.equal(byKey.get("unchanged")?.count, 2);
    // Every chip with rows reads as selected; none is empty here.
    assert.ok(chips.every((c) => c.selected));
    assert.ok(chips.every((c) => !c.empty));
    assert.ok(chips.every((c) => c.count === c.total));
    // Every chip carries a lower-case label and a tone class.
    assert.ok(chips.every((c) => c.label.length > 0));
    assert.ok(chips.every((c) => c.label === c.label.toLowerCase()));
    assert.ok(chips.every((c) => c.tone.startsWith("tone-")));
});

test("rowMatchesFilterKey routes verdict and status keys", () => {
    const [lost] = toImpactRows([
        row({ equal: false, actionA: {}, utteranceId: "l1" }),
    ]);
    assert.ok(rowMatchesFilterKey(lost, "regression"));
    assert.ok(rowMatchesFilterKey(lost, "lost-match"));
    assert.ok(!rowMatchesFilterKey(lost, "changed"));
    const [equal] = toImpactRows([row({ equal: true })]);
    assert.ok(rowMatchesFilterKey(equal, "unchanged"));
    assert.ok(!rowMatchesFilterKey(equal, "benign"));
});

test("visibleImpactRows drops the hidden ids, empty set shows all", () => {
    const rows = mixedRows();
    assert.equal(visibleImpactRows(rows, new Set()).length, rows.length);
    const shown = visibleImpactRows(rows, new Set(["l1", "e1"]));
    assert.equal(shown.length, rows.length - 2);
    assert.ok(shown.every((r) => r.utteranceId !== "l1"));
    assert.ok(shown.every((r) => r.utteranceId !== "e1"));
});

test("toggleFilterKey hides a chip's rows, then shows them again", () => {
    const rows = mixedRows();
    // regression names one row (the lost-match l1). Toggling hides it.
    const hidden = toggleFilterKey(rows, "regression", new Set());
    assert.ok(hidden.has("l1"));
    assert.equal(visibleImpactRows(rows, hidden).length, rows.length - 1);
    // Toggling again brings the same row back.
    const shownAgain = toggleFilterKey(rows, "regression", hidden);
    assert.ok(!shownAgain.has("l1"));
    assert.equal(visibleImpactRows(rows, shownAgain).length, rows.length);
});

test("deselecting improvement zeros the co-naming new-match chip", () => {
    const rows = mixedRows();
    // improvement and new-match name the SAME row (n1). Hiding improvement must
    // drop new-match's live count to 0 and deselect it — the reported bug.
    const hidden = toggleFilterKey(rows, "improvement", new Set());
    const chips = buildImpactFilterChips(rows, hidden);
    const byKey = new Map(chips.map((c) => [c.key, c]));
    assert.equal(byKey.get("improvement")?.count, 0);
    assert.equal(byKey.get("improvement")?.selected, false);
    assert.equal(byKey.get("new-match")?.count, 0);
    assert.equal(byKey.get("new-match")?.selected, false);
    // A total still records that the rows exist (so the chip is not disabled).
    assert.equal(byKey.get("new-match")?.total, 1);
    assert.equal(byKey.get("new-match")?.empty, false);
});

test("deselecting regression leaves the benign changed row visible", () => {
    const rows = mixedRows();
    // regression names the lost-match row; the changed→benign row (c1) is not a
    // regression, so it stays. lost-match drops to 0, changed stays selected.
    const hidden = toggleFilterKey(rows, "regression", new Set());
    const chips = buildImpactFilterChips(rows, hidden);
    const byKey = new Map(chips.map((c) => [c.key, c]));
    assert.equal(byKey.get("regression")?.count, 0);
    assert.equal(byKey.get("lost-match")?.count, 0);
    assert.equal(byKey.get("lost-match")?.selected, false);
    assert.equal(byKey.get("benign")?.count, 1);
    assert.equal(byKey.get("changed")?.count, 1);
    assert.equal(byKey.get("changed")?.selected, true);
});

test("None then a chip re-adds only that chip's rows", () => {
    const rows = mixedRows();
    // "None" hides everything; clicking regression brings its rows back.
    const noneHidden = allRowIds(rows);
    assert.ok(allRowsHidden(rows, noneHidden));
    assert.equal(visibleImpactRows(rows, noneHidden).length, 0);
    const reAdded = toggleFilterKey(rows, "regression", noneHidden);
    const shown = visibleImpactRows(rows, reAdded);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].verdict, "regression");
});

test("a chip with no matching rows is empty and disabled", () => {
    // Only equal rows: verdict/status buckets are empty and must be inert.
    const rows = toImpactRows([
        row({ equal: true, utteranceId: "e1" }),
        row({ equal: true, utteranceId: "e2" }),
    ]);
    const chips = buildImpactFilterChips(rows, new Set());
    const byKey = new Map(chips.map((c) => [c.key, c]));
    assert.equal(byKey.get("regression")?.total, 0);
    assert.equal(byKey.get("regression")?.empty, true);
    assert.equal(byKey.get("regression")?.selected, false);
    assert.equal(byKey.get("unchanged")?.total, 2);
    assert.equal(byKey.get("unchanged")?.empty, false);
});

test("allRowsVisible and allRowsHidden drive the All/None pills", () => {
    const rows = mixedRows();
    assert.ok(allRowsVisible(new Set()));
    assert.ok(!allRowsVisible(new Set(["e1"])));
    assert.ok(!allRowsHidden(rows, new Set(["e1"])));
    assert.ok(allRowsHidden(rows, allRowIds(rows)));
    // No rows: neither pill claims the fully-hidden state.
    assert.ok(!allRowsHidden([], new Set()));
});

// --- Utterance search ------------------------------------------------------

function searchRows() {
    return toImpactRows([
        row({ equal: true, utterance: "play some jazz", utteranceId: "s1" }),
        row({
            equal: false,
            actionA: {},
            actionB: {},
            utterance: "play the news",
            utteranceId: "s2",
        }),
        row({
            equal: false,
            actionB: {},
            utterance: "pause playback",
            utteranceId: "s3",
        }),
    ]);
}

test("rowMatchesSearch is case-insensitive and empty query matches all", () => {
    const [jazz] = searchRows();
    assert.ok(rowMatchesSearch(jazz, ""));
    assert.ok(rowMatchesSearch(jazz, "   "));
    assert.ok(rowMatchesSearch(jazz, "JAZZ"));
    assert.ok(rowMatchesSearch(jazz, "play"));
    assert.ok(!rowMatchesSearch(jazz, "news"));
});

test("visibleImpactRows narrows by the utterance search", () => {
    const rows = searchRows();
    assert.equal(visibleImpactRows(rows, new Set(), "").length, 3);
    const play = visibleImpactRows(rows, new Set(), "play");
    assert.equal(play.length, 3);
    const news = visibleImpactRows(rows, new Set(), "news");
    assert.equal(news.length, 1);
    assert.equal(news[0].utteranceId, "s2");
    // Search composes with chip-hiding: hide s2, then search still excludes s1/s3.
    assert.equal(visibleImpactRows(rows, new Set(["s2"]), "news").length, 0);
});

test("chip counts recompute over the searched rows", () => {
    const rows = searchRows();
    // Only "play the news" (a changed row) matches; unchanged/lost-match drop to 0
    // but keep their totals so they are not disabled.
    const chips = buildImpactFilterChips(rows, new Set(), "news");
    const byKey = new Map(chips.map((c) => [c.key, c]));
    assert.equal(byKey.get("changed")?.count, 1);
    assert.equal(byKey.get("changed")?.selected, true);
    assert.equal(byKey.get("unchanged")?.count, 0);
    assert.equal(byKey.get("unchanged")?.selected, false);
    assert.equal(byKey.get("unchanged")?.total, 1);
    assert.equal(byKey.get("unchanged")?.empty, false);
});

test("toggleFilterKey only acts on rows admitted by the search", () => {
    const rows = searchRows();
    // With a "play" search every row is admitted; hiding "unchanged" hides s1.
    const hidden = toggleFilterKey(rows, "unchanged", new Set(), "play");
    assert.ok(hidden.has("s1"));
    // A search that excludes the chip's rows makes the toggle a no-op.
    const noop = toggleFilterKey(rows, "unchanged", new Set(), "news");
    assert.equal(noop.size, 0);
});

// --- Column sorting --------------------------------------------------------

function sortableRows() {
    return toImpactRows([
        row({
            equal: false,
            actionA: {},
            utterance: "banana",
            utteranceId: "r1",
            latencyA: 5,
            latencyB: 30,
        }),
        row({
            equal: true,
            utterance: "apple",
            utteranceId: "r2",
            latencyA: 8,
            latencyB: 10,
        }),
        row({
            equal: false,
            actionA: {},
            actionB: {},
            utterance: "cherry",
            utteranceId: "r3",
            latencyA: 2,
            latencyB: 20,
        }),
    ]);
}

test("sortImpactRows sorts utterance ascending and descending", () => {
    const rows = sortableRows();
    const asc = sortImpactRows(rows, {
        column: "utterance",
        direction: "asc",
    });
    assert.deepEqual(
        asc.map((r) => r.utterance),
        ["apple", "banana", "cherry"],
    );
    const desc = sortImpactRows(rows, {
        column: "utterance",
        direction: "desc",
    });
    assert.deepEqual(
        desc.map((r) => r.utterance),
        ["cherry", "banana", "apple"],
    );
});

test("sortImpactRows sorts latency numerically on the Compare (B) side", () => {
    const rows = sortableRows();
    const asc = sortImpactRows(rows, { column: "latency", direction: "asc" });
    assert.deepEqual(
        asc.map((r) => r.latencyB),
        [10, 20, 30],
    );
    const desc = sortImpactRows(rows, { column: "latency", direction: "desc" });
    assert.deepEqual(
        desc.map((r) => r.latencyB),
        [30, 20, 10],
    );
});

test("sortImpactRows orders impact by regression-first verdict rank", () => {
    const rows = sortableRows();
    // r1 lost-match=regression, r3 changed=benign, r2 equal=neutral.
    const asc = sortImpactRows(rows, { column: "impact", direction: "asc" });
    assert.deepEqual(
        asc.map((r) => r.verdict),
        ["regression", "benign", "neutral"],
    );
});

test("sortImpactRows is stable on ties, preserving incoming order", () => {
    const rows = sortableRows();
    // All three have distinct statuses except none tie here; use utterance ties
    // by duplicating the label to confirm the original order is kept.
    const dupes = toImpactRows([
        row({ equal: true, utterance: "same", utteranceId: "d1" }),
        row({
            equal: false,
            actionA: {},
            utterance: "same",
            utteranceId: "d2",
        }),
        row({
            equal: false,
            actionB: {},
            utterance: "same",
            utteranceId: "d3",
        }),
    ]);
    const sorted = sortImpactRows(dupes, {
        column: "utterance",
        direction: "asc",
    });
    assert.deepEqual(
        sorted.map((r) => r.utteranceId),
        ["d1", "d2", "d3"],
    );
});

test("hiddenRowsNote reports how many rows the filters hide", () => {
    assert.equal(hiddenRowsNote(5, 3), "2 rows hidden by filters.");
    assert.equal(hiddenRowsNote(5, 4), "1 row hidden by filters.");
});

test("hiddenRowsNote is silent when nothing is hidden", () => {
    assert.equal(hiddenRowsNote(5, 5), undefined);
    assert.equal(hiddenRowsNote(0, 0), undefined);
});

test("toImpactRow tags each row with a regression verdict", () => {
    const [regression] = toImpactRows([
        row({ equal: false, actionA: {}, utteranceId: "l1" }),
    ]);
    assert.equal(regression.verdict, "regression");
    assert.equal(regression.impactLabel, "regression");
    assert.equal(regression.verdictReason, "No longer resolves");

    const [improvement] = toImpactRows([
        row({ equal: false, actionB: {}, utteranceId: "n1" }),
    ]);
    assert.equal(improvement.verdict, "improvement");
    assert.equal(improvement.verdictReason, "Now resolves");

    const [actionChanged] = toImpactRows([
        row({
            equal: false,
            actionA: { actionName: "playTrack" },
            actionB: { actionName: "playAlbum" },
            utteranceId: "c1",
        }),
    ]);
    assert.equal(actionChanged.verdict, "regression");
    assert.equal(actionChanged.verdictReason, "Action changed");

    const [additive] = toImpactRows([
        row({
            equal: false,
            actionA: { actionName: "playTrack", parameters: {} },
            actionB: {
                actionName: "playTrack",
                parameters: { device: "kitchen" },
            },
            utteranceId: "c2",
        }),
    ]);
    assert.equal(additive.verdict, "benign");
    assert.equal(additive.verdictReason, "Only added parameters");

    const [equal] = toImpactRows([row({ equal: true })]);
    assert.equal(equal.verdict, "neutral");
    assert.equal(equal.impactLabel, "");
});

test("toImpactRow lets side-B feedback override the structural verdict", () => {
    const [row1] = toImpactRows([
        row({
            equal: false,
            actionA: {},
            actionB: {},
            feedbackB: { rating: "down", recordedAt: 0 },
            utteranceId: "c1",
        }),
    ]);
    assert.equal(row1.verdict, "regression");
    assert.equal(row1.verdictReason, "Marked by feedback");
    assert.ok(row1.verdictFromFeedback);
});

test("sortImpactRowsByVerdict surfaces likely regressions first", () => {
    const sorted = sortImpactRowsByVerdict(mixedRows());
    assert.deepEqual(
        sorted.map((r) => r.verdict),
        ["regression", "benign", "improvement", "neutral", "neutral"],
    );
});

test("summarizeVerdicts tallies every verdict", () => {
    const s = summarizeVerdicts(mixedRows());
    assert.equal(s.regression, 1);
    assert.equal(s.improvement, 1);
    assert.equal(s.benign, 1);
    assert.equal(s.neutral, 2);
});

test("toVerdictBanner leads with regressions when any exist", () => {
    const banner = toVerdictBanner(mixedRows());
    assert.ok(banner);
    assert.equal(banner!.tone, "regression");
    assert.equal(banner!.headline, "1 likely regression");
    assert.ok(/1 improvement/.test(banner!.detail));
    assert.ok(/1 benign/.test(banner!.detail));
    assert.ok(/2 unchanged/.test(banner!.detail));
});

test("toVerdictBanner reads clean when nothing likely regressed", () => {
    const banner = toVerdictBanner(
        toImpactRows([
            row({ equal: true, utteranceId: "e1" }),
            row({ equal: false, actionB: {}, utteranceId: "n1" }),
        ]),
    );
    assert.ok(banner);
    assert.equal(banner!.tone, "clean");
    assert.equal(banner!.headline, "No likely regressions");
    assert.ok(/1 improvement/.test(banner!.detail));
});

test("toVerdictBanner is undefined for an empty run", () => {
    assert.equal(toVerdictBanner([]), undefined);
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

function fidelityReport(
    realization: SideFidelity["A"]["realization"],
    overrides: Partial<SideFidelity["A"]["layers"]> = {},
): SideFidelity["A"] {
    const ran = { status: "ran", reason: "ran reason" } as const;
    return {
        realization,
        layers: {
            grammar: { ...ran },
            schemaEnrichment: { ...ran },
            constructionCache: { ...ran },
            wildcardValidation: { ...ran },
            dispatch: { status: "unavailable", reason: "no dispatch" },
            ...overrides,
        },
    };
}

test("toFidelityMatrix returns undefined when no descriptor", () => {
    assert.equal(toFidelityMatrix(undefined), undefined);
});

test("toFidelityMatrix produces one row per layer in order", () => {
    const view = toFidelityMatrix({
        A: fidelityReport("built-live"),
        B: fidelityReport("built-live"),
    });
    assert.ok(view);
    assert.deepEqual(
        view!.rows.map((r) => r.layer),
        [
            "Grammar match",
            "Schema enrichment",
            "Construction cache",
            "Wildcard validation",
            "Full dispatch",
        ],
    );
    assert.equal(view!.realizationA, "built (live)");
    assert.equal(view!.realizationB, "built (live)");
});

test("toFidelityMatrix carries per-side status and reason", () => {
    const view = toFidelityMatrix({
        A: fidelityReport("built-live"),
        B: fidelityReport("source", {
            constructionCache: {
                status: "unavailable",
                reason: "no cache at a ref",
            },
        }),
    });
    assert.ok(view);
    const cacheRow = view!.rows.find((r) => r.layer === "Construction cache");
    assert.ok(cacheRow);
    assert.equal(cacheRow!.a.status, "ran");
    assert.equal(cacheRow!.b.status, "unavailable");
    assert.equal(cacheRow!.b.reason, "no cache at a ref");
});
