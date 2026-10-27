// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TopicConcept, TopicNode, TopicSnapshot } from "./topicTypes.js";
import type { ViewCitation } from "./viewTypes.js";
import { viewHash } from "./viewMerge.js";

const evidenceLimit =
    "Summary uses bounded original-source context, including nominated qualifications; full incidence remains maintained.";
export const topicSourceKey = (value: {
    sourceId: string;
    revisionId: string;
}) => JSON.stringify([value.sourceId, value.revisionId]);
const terms = (text: string) =>
    new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
const labelKey = (label: string) => label.trim().toLowerCase();

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
    private readonly nodes;
    private readonly occurrences;
    private readonly sources = new Map<
        string,
        { ordinal: number; citation: ViewCitation }[]
    >();
    private readonly hashes = new Map<string, Set<string>>();
    private readonly exactEvidence = new Map<string, Set<string>>();
    private readonly contexts = new Map<
        string,
        { context: ViewCitation[]; ranked: ViewCitation[] }
    >();
    private readonly selections = new Map<string, ViewCitation[]>();

    public constructor(snapshot: TopicSnapshot) {
        this.nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
        this.occurrences = new Map(
            snapshot.occurrences.map((entry) => [entry.id, entry]),
        );
        let ordinal = 0;
        for (const occurrence of snapshot.occurrences) {
            const key = topicSourceKey(occurrence);
            const citations = this.sources.get(key) ?? [];
            const hashes = this.hashes.get(key) ?? new Set<string>();
            for (const citation of occurrence.citations) {
                citations.push({ ordinal: ordinal++, citation });
                hashes.add(viewHash(citation));
            }
            this.sources.set(key, citations);
            this.hashes.set(key, hashes);
        }
    }

    public memberSources(memberIds: readonly string[]): Set<string> {
        const sources = new Set<string>();
        for (const id of memberIds) {
            const node = this.nodes.get(id);
            if (!node) throw new Error("Unknown topic member");
            for (const occurrenceId of node.occurrenceIds) {
                const occurrence = this.occurrences.get(occurrenceId);
                if (!occurrence) throw new Error("Unknown topic occurrence");
                sources.add(topicSourceKey(occurrence));
            }
        }
        return sources;
    }

    public ownsSources(
        memberIds: readonly string[],
        citations: readonly ViewCitation[],
    ): boolean {
        const sources = this.memberSources(memberIds);
        return citations.every((citation) =>
            sources.has(topicSourceKey(citation)),
        );
    }

    public ownsEvidence(
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

    public evidence(node: TopicNode): ViewCitation[] {
        const selected = this.selections.get(node.id);
        if (selected) return selected.slice();
        const keys = [...this.memberSources([node.id])].sort();
        const key = JSON.stringify(keys);
        let group = this.contexts.get(key);
        if (!group) {
            const context = [
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
            group = {
                context,
                ranked: [...context].sort(
                    (a, b) => priority(b.excerpt) - priority(a.excerpt),
                ),
            };
            this.contexts.set(key, group);
        }
        const evidence = [
            ...new Map(
                [
                    ...node.citations.slice(0, 2),
                    ...group.ranked,
                    ...group.context.slice(-2),
                ].map((citation) => [JSON.stringify(citation), citation]),
            ).values(),
        ].slice(0, 8);
        if (
            group.context.length > evidence.length &&
            !node.limits.includes(evidenceLimit)
        )
            node.limits.push(evidenceLimit);
        this.selections.set(node.id, evidence);
        return evidence.slice();
    }

    public ownsExactEvidence(
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
}

export class TopicNominationIndex {
    private readonly concepts = new Map<string, TopicConcept>();
    private readonly labels = new Map<string, Set<string>>();
    private readonly postings = new Map<string, Set<string>>();
    private readonly conceptTerms = new Map<string, Set<string>>();

    public constructor(concepts: readonly TopicConcept[] = []) {
        concepts.forEach((concept) => this.add(concept));
    }

    public replace(
        removed: readonly TopicConcept[],
        added: readonly TopicConcept[],
    ): void {
        removed.forEach((concept) => this.remove(concept.id));
        added.forEach((concept) => this.add(concept));
    }

    public related(nodes: readonly { label: string }[]): TopicConcept[] {
        const scores = new Map<string, number>();
        for (const term of terms(nodes.map((node) => node.label).join(" ")))
            for (const id of this.postings.get(term) ?? [])
                scores.set(id, (scores.get(id) ?? 0) + 1);
        const exact = new Set<string>();
        for (const node of nodes)
            for (const id of this.labels.get(labelKey(node.label)) ?? []) {
                exact.add(id);
                if (!scores.has(id)) scores.set(id, 0);
            }
        return [...scores]
            .sort(
                ([a, scoreA], [b, scoreB]) =>
                    Number(exact.has(b)) - Number(exact.has(a)) ||
                    scoreB - scoreA ||
                    a.localeCompare(b),
            )
            .slice(0, 24)
            .map(([id]) => this.concepts.get(id)!);
    }

    private add(concept: TopicConcept): void {
        this.remove(concept.id);
        this.concepts.set(concept.id, concept);
        const keys = terms(`${concept.label} ${concept.purpose}`);
        this.conceptTerms.set(concept.id, keys);
        this.insert(this.labels, labelKey(concept.label), concept.id);
        keys.forEach((term) => this.insert(this.postings, term, concept.id));
    }

    private remove(id: string): void {
        const concept = this.concepts.get(id);
        if (!concept) return;
        this.erase(this.labels, labelKey(concept.label), id);
        this.conceptTerms
            .get(id)!
            .forEach((term) => this.erase(this.postings, term, id));
        this.conceptTerms.delete(id);
        this.concepts.delete(id);
    }

    private insert(index: Map<string, Set<string>>, key: string, id: string) {
        const entries = index.get(key) ?? new Set<string>();
        entries.add(id);
        index.set(key, entries);
    }

    private erase(index: Map<string, Set<string>>, key: string, id: string) {
        const entries = index.get(key)!;
        entries.delete(id);
        if (!entries.size) index.delete(key);
    }
}
