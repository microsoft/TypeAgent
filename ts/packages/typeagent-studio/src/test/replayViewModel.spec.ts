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
    filterImpactRows,
    defaultImpactFilters,
    allStatusesActive,
    impactFilterNote,
    impactEmptyState,
    allRowsEqual,
    IMPACT_FILTER_ORDER,
    toFidelityMatrix,
    type ReplayRowStatus,
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
    // No source side → no preflight hint.
    assert.equal(view!.preflight, undefined);
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

test("toFidelityMatrix adds a preflight hint for a single source side", () => {
    const view = toFidelityMatrix({
        A: fidelityReport("built-live"),
        B: fidelityReport("source"),
    });
    assert.ok(view);
    assert.ok(view!.preflight);
    assert.ok(/Side B is /.test(view!.preflight!));
});

test("toFidelityMatrix pluralizes the preflight hint for two source sides", () => {
    const view = toFidelityMatrix({
        A: fidelityReport("source"),
        B: fidelityReport("source"),
    });
    assert.ok(view);
    assert.ok(view!.preflight);
    assert.ok(/Side A & B are /.test(view!.preflight!));
});
