// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TopicConcept, TopicNode, TopicSnapshot } from "./topicTypes.js";
import type { ViewCitation } from "./viewTypes.js";
import { viewHash } from "./viewMerge.js";

export { TopicConceptIndex as TopicNominationIndex };

export const topicSourceKey = (value: {
    sourceId: string;
    revisionId: string;
}) => JSON.stringify([value.sourceId, value.revisionId]);
const terms = (text: string) =>
    new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
const labelKey = (text: string) => text.trim().toLowerCase();
const contextLimit =
    "Summary uses bounded original-source context, including nominated qualifications; full incidence remains maintained.";

function priority(text: string): number {
    if (/Governing tail exception:/i.test(text)) return 3;
    if (/governing|withdraw|invalid|correct|supersed|retract/i.test(text))
        return 2;
    return /qualification|caveat|only|cohort|not applicable|held lease/i.test(
        text,
    )
        ? 1
        : 0;
}

export class TopicEvidenceIndex {
    private readonly nodes = new Map<
        string,
        { node: TopicNode; ordinal: number; membership: string }
    >();
    private readonly occurrences = new Map<string, string>();
    private readonly sources = new Map<
        string,
        Array<{ ordinal: number; citation: ViewCitation }>
    >();
    private readonly contexts = new Map<
        string,
        { citations: ViewCitation[]; ranked: ViewCitation[] }
    >();
    private readonly hashes = new Map<string, Set<string>>();
    private readonly exactEvidence = new Map<string, Set<string>>();
    private readonly sourceVersion: string;

    constructor(snapshot: TopicSnapshot) {
        this.sourceVersion = viewHash(
            JSON.stringify([snapshot.inputFingerprint, snapshot.occurrences]),
        );
        snapshot.nodes.forEach((node, ordinal) =>
            this.nodes.set(node.id, {
                node,
                ordinal,
                membership: JSON.stringify(node.occurrenceIds),
            }),
        );
        snapshot.occurrences.forEach((occurrence, ordinal) => {
            const key = topicSourceKey(occurrence);
            this.occurrences.set(occurrence.id, key);
            const entries = this.sources.get(key) ?? [];
            const hashes = this.hashes.get(key) ?? new Set<string>();
            for (const citation of occurrence.citations) {
                entries.push({ ordinal, citation });
                hashes.add(viewHash(citation));
            }
            this.sources.set(key, entries);
            this.hashes.set(key, hashes);
        });
    }

    assertSnapshot(snapshot: TopicSnapshot): void {
        if (
            this.sourceVersion !==
                viewHash(
                    JSON.stringify([
                        snapshot.inputFingerprint,
                        snapshot.occurrences,
                    ]),
                ) ||
            snapshot.nodes.some(
                (node) =>
                    this.nodes.get(node.id)?.membership !==
                    JSON.stringify(node.occurrenceIds),
            )
        )
            throw new Error(
                "Topic evidence index belongs to a different snapshot version",
            );
    }

    members(memberIds: readonly string[]): TopicNode[] {
        const entries = [...new Set(memberIds)].map((id) => {
            const entry = this.nodes.get(id);
            if (!entry)
                throw new Error("Decision target lost original membership");
            return entry;
        });
        if (!entries.length || entries.length !== memberIds.length)
            throw new Error("Decision target lost original membership");
        return entries
            .sort((a, b) => a.ordinal - b.ordinal)
            .map(({ node }) => node);
    }

    memberSources(memberIds: readonly string[]): Set<string> {
        const sources = new Set<string>();
        for (const id of memberIds) {
            const entry = this.nodes.get(id);
            if (!entry) throw new Error("Unknown topic member");
            if (entry.membership !== JSON.stringify(entry.node.occurrenceIds))
                throw new Error("Topic evidence index membership changed");
            for (const occurrence of entry.node.occurrenceIds) {
                const key = this.occurrences.get(occurrence);
                if (key === undefined)
                    throw new Error("Unknown topic occurrence");
                sources.add(key);
            }
        }
        return sources;
    }

    ownsSources(
        memberIds: readonly string[],
        citations: readonly ViewCitation[],
    ): boolean {
        const sources = this.memberSources(memberIds);
        return citations.every((citation) =>
            sources.has(topicSourceKey(citation)),
        );
    }

    ownsEvidence(
        memberIds: readonly string[],
        citations: readonly ViewCitation[],
    ): boolean {
        const sources = this.memberSources(memberIds);
        return citations.every((citation) => {
            const key = topicSourceKey(citation);
            return (
                sources.has(key) &&
                this.hashes.get(key)?.has(viewHash(citation)) === true
            );
        });
    }

    ownsExactEvidence(
        memberIds: readonly string[],
        citations: readonly ViewCitation[],
    ): boolean {
        const sources = this.memberSources(memberIds);
        return citations.every((citation) => {
            if (!citation || typeof citation !== "object") return false;
            const key = topicSourceKey(citation);
            if (!sources.has(key)) return false;
            let evidence = this.exactEvidence.get(key);
            if (!evidence) {
                evidence = new Set(
                    (this.sources.get(key) ?? []).map(({ citation }) =>
                        JSON.stringify(citation),
                    ),
                );
                this.exactEvidence.set(key, evidence);
            }
            return evidence.has(JSON.stringify(citation));
        });
    }

    evidence(node: TopicNode): ViewCitation[] {
        return this.evidenceFor(node);
    }

    evidenceFor(node: TopicNode): ViewCitation[] {
        const keys = [
            ...new Set(
                node.occurrenceIds.flatMap((id) => {
                    const key = this.occurrences.get(id);
                    return key === undefined ? [] : [key];
                }),
            ),
        ].sort();
        const key = JSON.stringify(keys);
        let context = this.contexts.get(key);
        if (!context) {
            const citations = [
                ...new Map(
                    keys
                        .flatMap((key) => this.sources.get(key) ?? [])
                        .sort((a, b) => a.ordinal - b.ordinal)
                        .map(({ citation }) => [
                            JSON.stringify(citation),
                            citation,
                        ]),
                ).values(),
            ];
            context = {
                citations,
                ranked: [...citations].sort(
                    (a, b) => priority(b.excerpt) - priority(a.excerpt),
                ),
            };
            this.contexts.set(key, context);
        }
        const result = [
            ...new Map(
                [
                    ...node.citations.slice(0, 2),
                    ...context.ranked,
                    ...context.citations.slice(-2),
                ].map((citation) => [JSON.stringify(citation), citation]),
            ).values(),
        ].slice(0, 8);
        if (
            context.citations.length > result.length &&
            !node.limits.includes(contextLimit)
        )
            node.limits.push(contextLimit);
        return result;
    }
}

type LexicalEntry = {
    concept: TopicConcept;
    terms: Set<string>;
    label: string;
    text: string;
};

export class TopicConceptIndex {
    private readonly entries = new Map<string, LexicalEntry>();
    private readonly postings = new Map<string, Set<string>>();
    private readonly labels = new Map<string, Set<string>>();
    readonly positions = new Map<string, number>();

    constructor(concepts: readonly TopicConcept[] = []) {
        this.update(concepts);
    }

    update(concepts: readonly TopicConcept[]): void {
        const retained = new Set(concepts.map((concept) => concept.id));
        for (const [id, entry] of this.entries)
            if (!retained.has(id)) this.remove(id, entry);
        this.positions.clear();
        concepts.forEach((concept, ordinal) => {
            this.positions.set(concept.id, ordinal);
            const previous = this.entries.get(concept.id);
            const text = JSON.stringify([concept.label, concept.purpose]);
            if (previous?.text === text) {
                previous.concept = concept;
                return;
            }
            if (previous) this.remove(concept.id, previous);
            const entry = {
                concept,
                terms: terms(`${concept.label} ${concept.purpose}`),
                label: labelKey(concept.label),
                text,
            };
            this.entries.set(concept.id, entry);
            for (const term of entry.terms)
                this.add(this.postings, term, concept.id);
            this.add(this.labels, entry.label, concept.id);
        });
    }

    replace(
        removed: readonly TopicConcept[],
        added: readonly TopicConcept[],
    ): void {
        const remove = new Set(
            [...removed, ...added].map((concept) => concept.id),
        );
        this.update([
            ...[...this.entries.values()]
                .filter(({ concept }) => !remove.has(concept.id))
                .map(({ concept }) => concept),
            ...added,
        ]);
    }

    related(nodes: ReadonlyArray<{ label: string }>): TopicConcept[] {
        return this.query(nodes);
    }

    query(nodes: ReadonlyArray<{ label: string }>): TopicConcept[] {
        const scores = new Map<string, number>();
        const exact = new Set<string>();
        for (const term of terms(nodes.map((node) => node.label).join(" ")))
            for (const id of this.postings.get(term) ?? [])
                scores.set(id, (scores.get(id) ?? 0) + 1);
        for (const node of nodes)
            for (const id of this.labels.get(labelKey(node.label)) ?? []) {
                exact.add(id);
                if (!scores.has(id)) scores.set(id, 0);
            }

        return [...scores]
            .sort(
                ([a, aScore], [b, bScore]) =>
                    Number(exact.has(b)) - Number(exact.has(a)) ||
                    bScore - aScore ||
                    a.localeCompare(b),
            )
            .slice(0, 24)
            .map(([id]) => this.entries.get(id)!.concept);
    }

    private add(
        index: Map<string, Set<string>>,
        key: string,
        id: string,
    ): void {
        const values = index.get(key) ?? new Set<string>();
        values.add(id);
        index.set(key, values);
    }

    private remove(id: string, entry: LexicalEntry): void {
        for (const term of entry.terms) {
            const values = this.postings.get(term)!;
            values.delete(id);
            if (!values.size) this.postings.delete(term);
        }
        const labels = this.labels.get(entry.label)!;
        labels.delete(id);
        if (!labels.size) this.labels.delete(entry.label);
        this.entries.delete(id);
    }
}
