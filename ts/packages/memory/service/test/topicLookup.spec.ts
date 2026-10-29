// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    TopicEvidenceIndex,
    TopicNominationIndex,
} from "../src/topicLookup.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import { initialTopicNodes } from "../src/topicSnapshot.js";
import { validateTopicCurationProgress } from "../src/topicCuration.js";
import type {
    TopicConcept,
    TopicNode,
    TopicSnapshot,
} from "../src/topicTypes.js";

function fixture(): TopicSnapshot {
    const occurrences = Array.from({ length: 40 }, (_, index) =>
        indexedTopicOccurrence(
            {
                sourceId: `s${index % 3}`,
                revisionId: "r1",
                blockOrdinal: index,
                text: `${index}: ${index % 7 ? "Reference explanation" : "Governing tail exception: only approved cohorts"}`,
                score: 1,
            },
            `Reference ${index}`,
            0,
        ),
    );
    return {
        schemaVersion: 1,
        corpusId: "test",
        generation: "g",
        inputFingerprint: "a".repeat(64),
        recipe: "test",
        generatedAt: "2026-10-25T00:00:00Z",
        occurrences,
        nodes: initialTopicNodes("test", occurrences),
        influenceSources: [],
        parents: [],
        related: [],
        limits: [],
    };
}

function originalEvidence(snapshot: TopicSnapshot, node: TopicNode) {
    const membership = new Set(node.occurrenceIds);
    const sources = new Set(
        snapshot.occurrences
            .filter((entry) => membership.has(entry.id))
            .map((entry) => `${entry.sourceId}\n${entry.revisionId}`),
    );
    const context = [
        ...new Map(
            snapshot.occurrences
                .filter((entry) =>
                    sources.has(`${entry.sourceId}\n${entry.revisionId}`),
                )
                .flatMap((entry) => entry.citations)
                .map((citation) => [JSON.stringify(citation), citation]),
        ).values(),
    ];
    const priority = (text: string) =>
        /Governing tail exception:/i.test(text)
            ? 3
            : /governing|withdraw|invalid|correct|supersed|retract/i.test(text)
              ? 2
              : /qualification|caveat|only|cohort|not applicable|held lease/i.test(
                      text,
                  )
                ? 1
                : 0;
    return [
        ...new Map(
            [
                ...node.citations.slice(0, 2),
                ...[...context].sort(
                    (a, b) => priority(b.excerpt) - priority(a.excerpt),
                ),
                ...context.slice(-2),
            ].map((citation) => [JSON.stringify(citation), citation]),
        ).values(),
    ].slice(0, 8);
}

test("shared index retains ordered strict Decision members without owning packet positions", () => {
    const value = fixture();
    const index = new TopicEvidenceIndex(value);
    expect(index.members([value.nodes[8].id, value.nodes[1].id])).toEqual([
        value.nodes[1],
        value.nodes[8],
    ]);
    for (const members of [
        [],
        ["missing"],
        [value.nodes[0].id, value.nodes[0].id],
    ])
        expect(() => index.members(members)).toThrow("membership");
    const all = concepts();
    const nominations = new TopicNominationIndex(all);
    nominations.update([all[9], all[0]]);
    expect(nominations.query([{ label: "unmatched" }])).toEqual([]);
    expect(Reflect.has(nominations, "positions")).toBe(false);
    expect(nominations.query([{ label: "AI" }])).toEqual(
        nominations.related([{ label: "AI" }]),
    );
});

test("validation refuses reuse after evidence, incidence or snapshot identity changes", () => {
    const original = fixture();
    const index = new TopicEvidenceIndex(original);
    for (const change of [
        "evidence",
        "incidence",
        "fingerprint",
        "property-order",
    ] as const) {
        const value = structuredClone(original);
        value.curationProgress = {
            concepts: [],
            deferred: [
                { nodeId: value.nodes[0].id, reason: "A diagnostic deferral" },
            ],
        };
        if (change === "evidence")
            value.occurrences[0].citations[0].excerpt = "Changed evidence";
        else if (change === "incidence")
            value.nodes[0].occurrenceIds.push(value.occurrences[1].id);
        else if (change === "fingerprint")
            value.inputFingerprint = "b".repeat(64);
        else {
            const { excerpt, ...rest } = value.occurrences[0].citations[0];
            value.occurrences[0].citations[0] = { excerpt, ...rest };
        }
        expect(() => validateTopicCurationProgress(value, index)).toThrow(
            "snapshot version",
        );
    }
    original.nodes[0].occurrenceIds.push(original.occurrences[1].id);
    expect(() => index.memberSources([original.nodes[0].id])).toThrow(
        "membership changed",
    );
});

test("indexed evidence preserves scan ordering, qualification priority and interleaved multi-source context", () => {
    const value = fixture();
    value.nodes[0].occurrenceIds.push(value.occurrences[1].id);
    const index = new TopicEvidenceIndex(value);
    for (const node of value.nodes) {
        expect(index.evidence(node)).toEqual(originalEvidence(value, node));
        const limits = [...node.limits];
        index.evidence(node).pop();
        expect(index.evidence(node)).toEqual(originalEvidence(value, node));
        expect(node.limits).toEqual(limits);
    }
    expect(
        index.ownsEvidence([value.nodes[0].id], value.occurrences[1].citations),
    ).toBe(true);
    expect(
        index.ownsExactEvidence(
            [value.nodes[0].id],
            value.occurrences[1].citations,
        ),
    ).toBe(true);
    const citation = value.occurrences[0].citations[0];
    const { excerpt, ...rest } = citation;
    const reordered = { excerpt, ...rest };
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(citation));
    expect(index.ownsEvidence([value.nodes[0].id], [reordered])).toBe(true);
    expect(index.ownsExactEvidence([value.nodes[0].id], [reordered])).toBe(
        false,
    );
    expect(
        index.ownsSources([value.nodes[2].id], value.occurrences[0].citations),
    ).toBe(false);
    expect(
        index.ownsExactEvidence(
            [value.nodes[2].id],
            value.occurrences[0].citations,
        ),
    ).toBe(false);
    expect(
        index.ownsEvidence(
            [value.nodes[0].id],
            [
                {
                    ...value.occurrences[0].citations[0],
                    excerpt: "Invented evidence",
                },
            ],
        ),
    ).toBe(false);
    expect(() => index.memberSources(["missing"])).toThrow(
        "Unknown topic member",
    );
});

function concepts(): TopicConcept[] {
    return Array.from({ length: 80 }, (_, i) => ({
        id: `concept:${i.toString(16).padStart(32, "0")}`,
        label: i === 50 ? "AI" : i % 2 ? "Mércure topic" : "Reference",
        scope: "test",
        purpose: i % 3 ? "Durable reference science" : "Unrelated",
        memberIds: [`raw-${i}`],
        summary: "",
        summaryState: "pending",
        citations: [],
        salience: 5,
    }));
}

test.each([32, 320, 3200])(
    "delta replacement does not visit unchanged records in a catalog of %i",
    (size) => {
        const template = concepts()[0];
        let visits = 0;
        const all = Array.from({ length: size }, (_, ordinal) => {
            const concept = { ...template, id: `c${ordinal}` };
            return ordinal === 0
                ? concept
                : new Proxy(concept, {
                      get(target, key, receiver) {
                          if (["id", "label", "purpose"].includes(String(key)))
                              visits++;
                          return Reflect.get(target, key, receiver);
                      },
                  });
        });
        const index = new TopicNominationIndex(all);
        visits = 0;
        const replacement = {
            ...all[0],
            label: "revisedcore",
            purpose: "distinctfocus",
        };
        index.replace([all[0]], [replacement]);
        expect(visits).toBe(0);
        expect(index.query([{ label: "revisedcore" }])).toEqual([replacement]);
        const membershipOnly = { ...replacement, memberIds: ["new-member"] };
        index.replace([replacement], [membershipOnly]);
        expect(index.query([{ label: "revisedcore" }])[0]).toBe(membershipOnly);
        const renamed = { ...membershipOnly, label: "renamedcore" };
        index.replace([], [renamed, renamed]);
        expect(index.query([{ label: "revisedcore" }])).toEqual([]);
        expect(index.query([{ label: "renamedcore" }])).toEqual([renamed]);
        index.replace([renamed, renamed], []);
        expect(index.query([{ label: "renamedcore" }])).toEqual([]);
        expect(visits).toBe(0);
    },
);

function originalNomination(all: TopicConcept[], nodes: { label: string }[]) {
    const terms = (text: string) =>
        new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    const incoming = terms(nodes.map((node) => node.label).join(" "));
    const labels = new Set(
        nodes.map((node) => node.label.trim().toLowerCase()),
    );
    return all
        .map((concept) => ({
            concept,
            exact: labels.has(concept.label.trim().toLowerCase()),
            score: [...terms(`${concept.label} ${concept.purpose}`)].filter(
                (term) => incoming.has(term),
            ).length,
        }))
        .filter((entry) => entry.exact || entry.score > 0)
        .sort(
            (a, b) =>
                Number(b.exact) - Number(a.exact) ||
                b.score - a.score ||
                a.concept.id.localeCompare(b.concept.id),
        )
        .slice(0, 24)
        .map(({ concept }) => concept);
}

test("incremental postings preserve exact short labels, Unicode, ties and removal/replacement", () => {
    const all = concepts();
    const index = new TopicNominationIndex(all);
    for (const label of [
        "AI",
        "Mércure science",
        "Reference",
        "Unrelated",
        "No match",
    ])
        expect(index.related([{ label }])).toEqual(
            originalNomination(all, [{ label }]),
        );
    const replacement = { ...all[0], label: "New target", purpose: "Novel" };
    index.replace([all[0], all[50]], [replacement]);
    const current = [
        ...all.filter((entry) => entry !== all[0] && entry !== all[50]),
        replacement,
    ];
    for (const label of ["AI", "Mércure science", "New target"])
        expect(index.related([{ label }])).toEqual(
            originalNomination(current, [{ label }]),
        );
});
