// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IDictionary,
    IRelatedTermsMap,
    DictionaryEntry,
    RelatedTerm,
} from "./types.js";

/** Internal normalization: lowercase + trim */
function normalize(term: string): string {
    return term.toLowerCase().trim();
}

/**
 * In-memory dictionary: vocabulary enriched with lemmas, synonyms, entity types.
 * Built by processing the corpus vocabulary with an LLM (once, not per chunk).
 *
 * Lemmatization happens once during batch index building:
 *   entry = dictionary.lookup(keyword)
 *   lemma = entry?.lemma ?? keyword.toLowerCase()
 *   invertedIndex.addTerm(lemma, chunkId, score)
 *
 * At query time, the LLM generates the QueryPlan with already-lemmatized terms.
 */
export class Dictionary implements IDictionary {
    private entries: Map<string, DictionaryEntry> = new Map();

    lookup(term: string): DictionaryEntry | undefined {
        return this.entries.get(normalize(term));
    }

    getEntries(): DictionaryEntry[] {
        return Array.from(this.entries.values());
    }

    addEntry(entry: DictionaryEntry): void {
        this.entries.set(normalize(entry.term), entry);
    }

    getEntryCount(): number {
        return this.entries.size;
    }

    /** Serialize for JSON persistence */
    serialize(): DictionaryEntry[] {
        return this.getEntries();
    }

    /** Deserialize from JSON */
    deserialize(entries: DictionaryEntry[]): void {
        this.entries.clear();
        for (const entry of entries) {
            this.addEntry(entry);
        }
    }
}

/**
 * Related terms map: lemma → expanded related terms (also stored as lemmas).
 * buildFromDictionary() uses entry.lemma as keys so they align with
 * the inverted index (which also stores lemmas) and the query plan
 * (which provides lemmatized search terms).
 * Relationships are bidirectional: if run→jog, then jog→run.
 */
export class RelatedTermsMap implements IRelatedTermsMap {
    private map: Map<string, RelatedTerm[]> = new Map();

    lookup(term: string): RelatedTerm[] | undefined {
        return this.map.get(normalize(term));
    }

    /**
     * Add related terms for a term (one-directional).
     * Use addBidirectional() for symmetric relationships like synonyms.
     */
    add(term: string, related: RelatedTerm[]): void {
        const key = normalize(term);
        // Normalize the related terms too
        const normalized = related.map((r) => ({
            ...r,
            term: normalize(r.term),
        }));

        const existing = this.map.get(key);
        if (existing) {
            const seen = new Set(existing.map((r) => r.term));
            for (const r of normalized) {
                if (!seen.has(r.term) && r.term !== key) {
                    existing.push(r);
                    seen.add(r.term);
                }
            }
        } else {
            this.map.set(
                key,
                normalized.filter((r) => r.term !== key),
            );
        }
    }

    /**
     * Add a bidirectional relationship: if A→B then also B→A.
     * Use for symmetric relations like synonyms and aliases.
     */
    addBidirectional(
        termA: string,
        termB: string,
        relation: RelatedTerm["relation"],
        weight?: number,
    ): void {
        const relA: RelatedTerm = { term: termB, relation };
        const relB: RelatedTerm = { term: termA, relation };
        if (weight !== undefined) {
            relA.weight = weight;
            relB.weight = weight;
        }
        this.add(termA, [relA]);
        this.add(termB, [relB]);
    }

    getTermCount(): number {
        return this.map.size;
    }

    /** Serialize for JSON persistence */
    serialize(): { term: string; related: RelatedTerm[] }[] {
        const items: { term: string; related: RelatedTerm[] }[] = [];
        for (const [term, related] of this.map) {
            items.push({ term, related });
        }
        return items;
    }

    /** Deserialize from JSON */
    deserialize(items: { term: string; related: RelatedTerm[] }[]): void {
        this.map.clear();
        for (const item of items) {
            this.map.set(item.term, item.related);
        }
    }

    /**
     * Build from a dictionary: for each entry, create bidirectional mappings
     * for synonyms and aliases, and one-directional mappings for type inferences.
     *
     * All terms are stored as lemmas (from entry.lemma) so they match
     * the inverted index keys and the LLM-generated query plan terms.
     */
    buildFromDictionary(dictionary: IDictionary): void {
        // Helper: resolve a term to its lemma via the dictionary
        const toLemma = (term: string): string => {
            const entry = dictionary.lookup(term);
            return normalize(entry?.lemma ?? term);
        };

        for (const entry of dictionary.getEntries()) {
            const key = normalize(entry.lemma);

            for (const related of entry.relatedTerms) {
                const relatedLemma = toLemma(related.term);
                if (
                    related.relation === "synonym" ||
                    related.relation === "alias"
                ) {
                    // Symmetric: run↔jog
                    this.addBidirectional(
                        key,
                        relatedLemma,
                        related.relation,
                        related.weight,
                    );
                } else {
                    // Directional: taylor_swift → person
                    this.add(key, [{ ...related, term: relatedLemma }]);
                }
            }

            // Entity type: taylor_swift → artist
            if (entry.entityType) {
                this.add(key, [
                    {
                        term: normalize(entry.entityType),
                        relation: "type",
                        weight: 0.8,
                    },
                ]);
            }

            // Parent types: artist → person, celebrity
            if (entry.parentTypes) {
                for (const parentType of entry.parentTypes) {
                    this.add(key, [
                        {
                            term: normalize(parentType),
                            relation: "inference",
                            weight: 0.5,
                        },
                    ]);
                }
            }
        }
    }
}
