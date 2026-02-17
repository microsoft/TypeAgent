// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IInvertedIndex, ScoredChunkRef } from "./types.js";

/** Internal normalization: lowercase + trim */
function normalize(term: string): string {
    return term.toLowerCase().trim();
}

/**
 * In-memory inverted index: normalized term → scored chunk references.
 *
 * Lemmatization happens once during batch index building:
 * the caller looks up each keyword in the dictionary, gets entry.lemma,
 * and passes the lemma to addTerm(). The index stores lemma → chunks.
 *
 * At query time, the LLM generates the QueryPlan with already-lemmatized
 * search terms, so lookupTerm() receives lemmas directly.
 *
 * The index still normalizes to lowercase internally as a safety net.
 */
export class InvertedIndex implements IInvertedIndex {
    private map: Map<string, ScoredChunkRef[]> = new Map();

    addTerm(term: string, chunkId: number, score: number = 1.0): void {
        const key = normalize(term);
        if (!key) return;

        let refs = this.map.get(key);
        if (!refs) {
            refs = [];
            this.map.set(key, refs);
        }
        // Avoid duplicates for same chunk
        const existing = refs.find((r) => r.chunkId === chunkId);
        if (existing) {
            existing.score = Math.max(existing.score, score);
        } else {
            refs.push({ chunkId, score });
        }
    }

    lookupTerm(term: string): ScoredChunkRef[] | undefined {
        return this.map.get(normalize(term));
    }

    getTerms(): string[] {
        return Array.from(this.map.keys());
    }

    getTermCount(): number {
        return this.map.size;
    }

    removeTerm(term: string, chunkId: number): void {
        const key = normalize(term);
        const refs = this.map.get(key);
        if (!refs) return;
        const idx = refs.findIndex((r) => r.chunkId === chunkId);
        if (idx >= 0) refs.splice(idx, 1);
        if (refs.length === 0) this.map.delete(key);
    }

    /** Serialize for JSON persistence */
    serialize(): { term: string; refs: ScoredChunkRef[] }[] {
        const items: { term: string; refs: ScoredChunkRef[] }[] = [];
        for (const [term, refs] of this.map) {
            items.push({ term, refs });
        }
        return items;
    }

    /** Deserialize from JSON */
    deserialize(items: { term: string; refs: ScoredChunkRef[] }[]): void {
        this.map.clear();
        for (const item of items) {
            this.map.set(item.term, item.refs);
        }
    }
}
