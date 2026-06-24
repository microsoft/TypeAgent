// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import type { CorpusEntry, CorpusSource } from "@typeagent/core/corpus";
import {
    buildCorpusAgentNodes,
    buildCorpusEntryNodes,
    buildCorpusSourceNodes,
    CORPUS_SOURCE_ORDER,
    formatCorpusSource,
    truncateUtterance,
} from "../corpusTreePresentation.js";

function entry(overrides: Partial<CorpusEntry> = {}): CorpusEntry {
    return {
        id: "e1",
        utterance: "play some jazz",
        agent: "player",
        source: "in-repo",
        provenance: { sourceUri: "corpus/player.utterances.jsonl" },
        ...overrides,
    };
}

test("buildCorpusAgentNodes returns a placeholder when there are no agents", () => {
    const nodes = buildCorpusAgentNodes([]);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "empty");
    assert.equal(nodes[0].hasChildren, false);
    assert.equal(nodes[0].label, "No corpora available");
});

test("buildCorpusAgentNodes maps each agent sorted and expandable", () => {
    const nodes = buildCorpusAgentNodes(["player", "calendar"]);
    assert.deepEqual(
        nodes.map((n) => n.label),
        ["calendar", "player"],
    );
    assert.ok(nodes.every((n) => n.kind === "agent" && n.hasChildren));
    assert.equal(nodes[0].contextValue, "corpusAgent");
});

test("buildCorpusSourceNodes shows only present sources with counts in fixed order", () => {
    const nodes = buildCorpusSourceNodes("player", [
        entry({ id: "a", source: "feedback" }),
        entry({ id: "b", source: "in-repo" }),
        entry({ id: "c", source: "in-repo" }),
    ]);
    assert.deepEqual(
        nodes.map((n) => n.source),
        ["in-repo", "feedback"],
    );
    assert.equal(nodes[0].description, "2 entries");
    assert.equal(nodes[1].description, "1 entry");
    assert.equal(nodes[0].contextValue, "corpusSource");
});

test("buildCorpusSourceNodes returns an actionable seed node when no entries exist", () => {
    const nodes = buildCorpusSourceNodes("player", []);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "empty");
    assert.equal(nodes[0].label, "Seed in-repo corpus\u2026");
    assert.equal(nodes[0].contextValue, "corpusAgentSeed");
    assert.equal(nodes[0].agent, "player");
});

test("buildCorpusEntryNodes filters to the requested source and labels by utterance", () => {
    const nodes = buildCorpusEntryNodes("player", "in-repo", [
        entry({ id: "a", source: "in-repo", utterance: "play jazz" }),
        entry({ id: "b", source: "captures", utterance: "skip" }),
    ]);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "entry");
    assert.equal(nodes[0].label, "play jazz");
    assert.equal(nodes[0].entryId, "a");
    assert.equal(nodes[0].contextValue, "corpusEntry");
    assert.equal(nodes[0].description, undefined);
});

test("buildCorpusEntryNodes surfaces feedback via the row rating when present", () => {
    const nodes = buildCorpusEntryNodes("player", "feedback", [
        entry({
            id: "a",
            source: "feedback",
            feedback: { rating: "down", recordedAt: 1 },
        }),
    ]);
    // Feedback is conveyed by the row icon, not a description badge.
    assert.equal(nodes[0].description, undefined);
    assert.equal(nodes[0].feedbackRating, "down");
});

test("truncateUtterance collapses whitespace and caps length", () => {
    assert.equal(truncateUtterance("  play   jazz  "), "play jazz");
    const long = "a".repeat(120);
    const result = truncateUtterance(long);
    assert.equal(result.length, 80);
    assert.ok(result.endsWith("\u2026"));
});

test("formatCorpusSource covers every source and CORPUS_SOURCE_ORDER is complete", () => {
    const expected: Record<CorpusSource, string> = {
        "in-repo": "In-repo",
        captures: "Captures",
        external: "External",
        feedback: "Feedback",
    };
    for (const source of CORPUS_SOURCE_ORDER) {
        assert.equal(formatCorpusSource(source), expected[source]);
    }
    assert.equal(CORPUS_SOURCE_ORDER.length, 4);
});
