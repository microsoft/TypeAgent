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

test("buildCorpusSourceNodes renders file-backed sources as named file rows", () => {
    const nodes = buildCorpusSourceNodes("player", [
        entry({ id: "b", source: "in-repo" }),
        entry({ id: "c", source: "in-repo" }),
    ]);
    assert.deepEqual(
        nodes.map((n) => n.source),
        ["in-repo"],
    );
    // In-repo row is titled by the backing file name and carries its path.
    assert.equal(nodes[0].label, "player.utterances.jsonl");
    assert.equal(nodes[0].contextValue, "corpusFile");
    assert.equal(nodes[0].filePath, "corpus/player.utterances.jsonl");
    assert.equal(nodes[0].description, "2 entries");
});

test("buildCorpusSourceNodes emits one row per distinct external file", () => {
    const nodes = buildCorpusSourceNodes("player", [
        entry({
            id: "a",
            source: "external",
            provenance: { sourceUri: "/ext/regression.jsonl" },
        }),
        entry({
            id: "b",
            source: "external",
            provenance: { sourceUri: "/ext/regression.jsonl" },
        }),
        entry({
            id: "c",
            source: "external",
            provenance: { sourceUri: "/ext/smoke.jsonl" },
        }),
    ]);
    assert.deepEqual(
        nodes.map((n) => n.label),
        ["regression.jsonl", "smoke.jsonl"],
    );
    assert.ok(nodes.every((n) => n.contextValue === "corpusFile"));
    assert.equal(nodes[0].description, "2 entries");
    assert.equal(nodes[1].description, "1 entry");
});

test("buildCorpusSourceNodes returns an actionable seed node when no entries or file exist", () => {
    const nodes = buildCorpusSourceNodes("player", []);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "empty");
    assert.equal(nodes[0].label, "Create corpus file\u2026");
    assert.equal(nodes[0].description, "No entries yet");
    assert.equal(nodes[0].contextValue, "corpusAgentSeed");
    assert.equal(nodes[0].agent, "player");
});

test("buildCorpusSourceNodes shows an existing empty in-repo file as a row", () => {
    const nodes = buildCorpusSourceNodes(
        "player",
        [],
        "/repo/corpus/player.utterances.jsonl",
    );
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "source");
    assert.equal(nodes[0].contextValue, "corpusFile");
    assert.equal(nodes[0].label, "player.utterances.jsonl");
    assert.equal(nodes[0].filePath, "/repo/corpus/player.utterances.jsonl");
    assert.equal(nodes[0].description, "No entries yet");
    assert.equal(nodes[0].hasChildren, false);
});

test("buildCorpusEntryNodes filters to the group's file and labels by utterance", () => {
    const [group] = buildCorpusSourceNodes("player", [
        entry({ id: "a", source: "in-repo", utterance: "play jazz" }),
    ]);
    const nodes = buildCorpusEntryNodes(group, [
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

test("buildCorpusEntryNodes splits external entries by backing file", () => {
    const all = [
        entry({
            id: "a",
            source: "external",
            provenance: { sourceUri: "/ext/regression.jsonl" },
        }),
        entry({
            id: "b",
            source: "external",
            provenance: { sourceUri: "/ext/smoke.jsonl" },
        }),
    ];
    const [regression] = buildCorpusSourceNodes("player", all);
    const nodes = buildCorpusEntryNodes(regression, all);
    assert.deepEqual(
        nodes.map((n) => n.entryId),
        ["a"],
    );
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
    assert.equal(CORPUS_SOURCE_ORDER.length, 2);
});
