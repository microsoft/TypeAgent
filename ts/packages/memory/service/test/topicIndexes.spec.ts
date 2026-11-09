// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import { initialTopicNodes } from "../src/topicSnapshot.js";
import { summaryEvidence } from "../src/topicGeneration.js";
import { relatedTopicConcepts } from "../src/topicCuration.js";
import { TopicConceptIndex, TopicEvidenceIndex } from "../src/topicIndexes.js";
import {
    createTopicConceptGrounder,
    groundTopicConcept,
    indexTopicDecisionEvidence,
} from "../src/topicDecision.js";
import type { TopicConcept, TopicSnapshot } from "../src/topicTypes.js";

function fixture(): TopicSnapshot {
    const occurrences = Array.from({ length: 36 }, (_, index) =>
        indexedTopicOccurrence(
            {
                sourceId: `source${index % 2}`,
                revisionId: "r1",
                blockOrdinal: index,
                text: `${index % 5 === 0 ? "Governing tail exception:" : "qualification"} exact original ${index}`,
                score: 1,
            },
            `Topic ${index}`,
            index,
        ),
    );
    return {
        schemaVersion: 1,
        corpusId: "test",
        generation: "test",
        inputFingerprint: "a".repeat(64),
        recipe: "test",
        generatedAt: "2026-10-26T00:00:00Z",
        occurrences,
        nodes: initialTopicNodes("test", occurrences),
        influenceSources: [
            { sourceId: "source0", revisionId: "r1" },
            { sourceId: "source1", revisionId: "r1" },
        ],
        parents: [],
        related: [],
        limits: [],
    };
}

function concepts(): TopicConcept[] {
    return Array.from({ length: 80 }, (_, index) => ({
        id: `concept:${String(index).padStart(4, "0")}`,
        label: index % 7 === 0 ? "AI" : `Trail ${index % 5}`,
        scope: "Reference",
        purpose: index % 2 ? "biology trails" : "astronomy planets",
        memberIds: [`n${index}`],
        citations: [],
        salience: 4,
        summary: "",
    }));
}

test("source indexes preserve exact selection, order, original tails and node limits", () => {
    const original = fixture(),
        indexed = structuredClone(original);
    original.nodes[0].occurrenceIds.push(original.occurrences[1].id);
    indexed.nodes[0].occurrenceIds.push(indexed.occurrences[1].id);
    const index = new TopicEvidenceIndex(indexed);
    for (let ordinal = 0; ordinal < original.nodes.length; ordinal++) {
        expect(index.evidenceFor(indexed.nodes[ordinal])).toEqual(
            summaryEvidence(original, original.nodes[ordinal]),
        );
        expect(indexed.nodes[ordinal].limits).toEqual(
            original.nodes[ordinal].limits,
        );
    }
});

test("postings reproduce exact lexical top-24 including short exact labels and invalidate edits/removals", () => {
    const values = concepts(),
        index = new TopicConceptIndex(values);
    const queries = [
        "AI",
        "TRAIL 2",
        "biology trails",
        "astronomy",
        "unmatched",
        "\u00e9toile",
    ];
    for (const label of queries)
        expect(index.query([{ label }]).map((entry) => entry.id)).toEqual(
            relatedTopicConcepts(values, [
                { label, scope: "", id: "", citations: [] },
            ]).map((entry) => entry.id),
        );
    values[0].label = "unmatched";
    values[0].purpose = "\u00e9toile";
    values.splice(1, 5);
    index.update(values);
    for (const label of queries)
        expect(index.query([{ label }]).map((entry) => entry.id)).toEqual(
            relatedTopicConcepts(values, [
                { label, scope: "", id: "", citations: [] },
            ]).map((entry) => entry.id),
        );
});

test("grounding cache uses exact concept versions and resolves members in original snapshot order", () => {
    const value = fixture();
    const concept: TopicConcept = {
        id: "c0",
        label: "Topic",
        scope: "Reference",
        purpose: "Understand",
        memberIds: [value.nodes[4].id, value.nodes[1].id],
        citations: value.nodes[1].citations,
        salience: 4,
        summary: "",
    };
    const contexts = indexTopicDecisionEvidence(value);
    const ground = createTopicConceptGrounder(
        value,
        contexts,
        new TopicEvidenceIndex(value),
    );
    expect(ground(concept, "c7")).toEqual(
        groundTopicConcept(value, concept, "c7", contexts),
    );
    concept.label = "Updated topic";
    concept.memberIds.push(value.nodes[6].id);
    expect(ground(concept, "c7")).toEqual(
        groundTopicConcept(value, concept, "c7", contexts),
    );
    expect(() => ground({ ...concept, memberIds: ["missing"] }, "c7")).toThrow(
        "membership",
    );
});
