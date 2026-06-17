// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import type { ActionDelta, ReplaySummary } from "@typeagent/core/replay";
import {
    toImpactRows,
    toImpactSummaryLine,
    toImpactMethodNote,
    toImpactErrorLine,
    parseVersionInput,
    describeVersion,
    toImpactComparisonLine,
    toImpactHeaderFields,
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
    assert.equal(rows[0].detail, "A:hit B:hit \u00b7 10/12ms");
});

test("toImpactRows collapses long utterances", () => {
    const long = "x".repeat(200);
    const [r] = toImpactRows([row({ utterance: long })]);
    assert.ok(r.utterance.length <= 120);
    assert.ok(r.utterance.endsWith("\u2026"));
});

test("toImpactSummaryLine renders a headline", () => {
    const summary = {
        runId: "r1",
        agent: "player",
        versionA: { kind: "workingTree" },
        versionB: { kind: "workingTree" },
        corpusSize: 3,
        rowCount: 3,
        equalCount: 3,
        changedCount: 0,
        newMatchCount: 0,
        lostMatchCount: 0,
        collisionDelta: 0,
        duration: 42,
    } as ReplaySummary;
    const line = toImpactSummaryLine(summary);
    assert.ok(line.includes("player"));
    assert.ok(line.includes("3 rows"));
    assert.ok(line.includes("42ms"));
});

test("toImpactMethodNote labels static-grammar but stays silent for identity", () => {
    assert.equal(toImpactMethodNote("identity"), undefined);
    const note = toImpactMethodNote("static-grammar");
    assert.ok(note);
    assert.ok(/static grammar/i.test(note!));
    // Make the caveat explicit so results aren't read as authoritative dispatch.
    assert.ok(/indicative/i.test(note!));
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

test("describeVersion and toImpactComparisonLine read the resolved versions", () => {
    assert.equal(describeVersion({ kind: "workingTree" }), "working tree");
    assert.equal(describeVersion({ kind: "git", ref: "HEAD" }), "HEAD");
    const line = toImpactComparisonLine({
        versionA: { kind: "git", ref: "HEAD" },
        versionB: { kind: "workingTree" },
    } as ReplaySummary);
    assert.ok(line.includes("HEAD"));
    assert.ok(line.includes("working tree"));
    assert.ok(line.includes("\u2192"));
});

function headerValue(
    fields: ReturnType<typeof toImpactHeaderFields>,
    label: string,
): string | undefined {
    return fields.find((f) => f.label === label)?.value;
}

test("toImpactHeaderFields fills placeholders before a run", () => {
    const fields = toImpactHeaderFields({});
    // Every field present with a tooltip.
    assert.deepEqual(
        fields.map((f) => f.label),
        ["repo", "agent", "method", "fidelity", "sandbox", "policy"],
    );
    assert.ok(fields.every((f) => f.tooltip.length > 0));
    assert.equal(headerValue(fields, "repo"), "\u2014");
    assert.equal(headerValue(fields, "agent"), "\u2014");
    assert.equal(headerValue(fields, "method"), "\u2014");
    assert.equal(headerValue(fields, "policy"), "\u2014");
    // Sandbox is honestly "not used" — the static-grammar path is not sandbox-bound.
    assert.equal(headerValue(fields, "sandbox"), "not used");
});

test("toImpactHeaderFields reflects a static-grammar run as indicative", () => {
    const fields = toImpactHeaderFields({
        repo: "TypeAgent",
        agent: "player",
        method: "static-grammar",
        missPolicy: "needs-explanation",
    });
    assert.equal(headerValue(fields, "repo"), "TypeAgent");
    assert.equal(headerValue(fields, "agent"), "player");
    assert.equal(headerValue(fields, "method"), "static grammar");
    assert.equal(headerValue(fields, "fidelity"), "indicative");
    assert.equal(headerValue(fields, "policy"), "needs-explanation");
    assert.equal(headerValue(fields, "sandbox"), "not used");
});

test("toImpactHeaderFields labels the identity baseline distinctly", () => {
    const fields = toImpactHeaderFields({ method: "identity" });
    assert.equal(headerValue(fields, "method"), "identity");
    assert.ok(/baseline/i.test(headerValue(fields, "fidelity")!));
});
