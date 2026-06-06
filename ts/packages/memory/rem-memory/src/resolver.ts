// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Entity, Facet, ObservedEntity } from "./model.js";
import { mintEntityIri } from "./vocab.js";

// Identity resolution: fold noisy, pre-resolution observed entities into stable
// canonical entities. The extractor produces free-text, multi-valued types and
// inconsistent surface forms, so resolution is deliberately tolerant:
//
//   1. Normalize the surface name (lowercase, collapse whitespace, strip punctuation).
//   2. Block on the normalized name to find candidate canonical entities.
//   3. Optionally rank candidates by an injected embedding similarity function.
//   4. Merge only when confidence clears a threshold; otherwise mint a new id.
//
// The embedding step is injected so resolution is unit-testable offline.

/** Computes a similarity score in [0, 1] between two entity name strings. */
export type SimilarityFn = (a: string, b: string) => Promise<number>;

export type ResolverOptions = {
    /** Minimum similarity required to merge into an existing entity. */
    mergeThreshold?: number;
    /** Optional embedding-based similarity; falls back to exact-normalized match. */
    similarity?: SimilarityFn;
};

/** Normalize a surface form for blocking/equality. */
export function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "") // strip diacritics
        .replace(/[^a-z0-9\s]/g, " ") // punctuation -> space
        .replace(/\s+/g, " ")
        .trim();
}

/** Mint a new stable canonical entity id. */
export function mintEntityId(): string {
    return mintEntityIri();
}

function mergeStringSets(a: string[], b: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of [...a, ...b]) {
        const key = v.trim();
        if (key.length > 0 && !seen.has(key.toLowerCase())) {
            seen.add(key.toLowerCase());
            out.push(key);
        }
    }
    return out;
}

function mergeFacets(a: Facet[], b: Facet[]): Facet[] {
    const byName = new Map<string, Facet>();
    for (const f of [...a, ...b]) {
        // Later writes win for the same facet name.
        byName.set(f.name.toLowerCase(), f);
    }
    return [...byName.values()];
}

/**
 * In-memory canonical entity index with alias-aware resolution. Persistence of
 * the canonical entities themselves lives in the RDF store; this index is the
 * working set used during ingestion to decide merge-vs-mint.
 */
export class EntityResolver {
    private readonly byId = new Map<string, Entity>();
    /** normalized surface form -> canonical entity id */
    private readonly aliasIndex = new Map<string, string>();
    private readonly mergeThreshold: number;
    private readonly similarity: SimilarityFn | undefined;

    constructor(options: ResolverOptions = {}) {
        this.mergeThreshold = options.mergeThreshold ?? 0.82;
        this.similarity = options.similarity;
    }

    /** Seed the resolver with already-canonical entities (e.g. on load). */
    seed(entities: Iterable<Entity>): void {
        for (const entity of entities) {
            this.byId.set(entity.id, entity);
            this.indexAliases(entity);
        }
    }

    get(id: string): Entity | undefined {
        return this.byId.get(id);
    }

    all(): Entity[] {
        return [...this.byId.values()];
    }

    /**
     * Resolve an observed entity to a canonical entity, merging into an existing
     * one when confident or minting a new one otherwise. Returns the canonical
     * entity and whether it was newly created.
     */
    async resolve(
        observed: ObservedEntity,
    ): Promise<{ entity: Entity; created: boolean }> {
        const normalized = normalizeName(observed.name);

        // 1. Exact normalized alias hit.
        const exactId = this.aliasIndex.get(normalized);
        if (exactId !== undefined) {
            return { entity: this.absorb(exactId, observed), created: false };
        }

        // 2. Optional fuzzy match against existing canonical names.
        if (this.similarity !== undefined) {
            const best = await this.bestFuzzyMatch(observed.name);
            if (best !== undefined && best.score >= this.mergeThreshold) {
                return {
                    entity: this.absorb(best.id, observed),
                    created: false,
                };
            }
        }

        // 3. Mint a new canonical entity.
        const entity: Entity = {
            id: mintEntityId(),
            name: observed.name,
            aliases: [observed.name],
            types: mergeStringSets([], observed.types),
            facets: observed.facets ? mergeFacets([], observed.facets) : [],
        };
        this.byId.set(entity.id, entity);
        this.indexAliases(entity);
        return { entity, created: true };
    }

    private async bestFuzzyMatch(
        name: string,
    ): Promise<{ id: string; score: number } | undefined> {
        if (this.similarity === undefined) {
            return undefined;
        }
        let best: { id: string; score: number } | undefined;
        for (const entity of this.byId.values()) {
            const score = await this.similarity(name, entity.name);
            if (best === undefined || score > best.score) {
                best = { id: entity.id, score };
            }
        }
        return best;
    }

    /** Fold an observed entity's data into an existing canonical entity. */
    private absorb(id: string, observed: ObservedEntity): Entity {
        const existing = this.byId.get(id)!;
        const merged: Entity = {
            id: existing.id,
            name: existing.name,
            aliases: mergeStringSets(existing.aliases, [observed.name]),
            types: mergeStringSets(existing.types, observed.types),
            facets: observed.facets
                ? mergeFacets(existing.facets, observed.facets)
                : existing.facets,
        };
        this.byId.set(id, merged);
        this.indexAliases(merged);
        return merged;
    }

    private indexAliases(entity: Entity): void {
        for (const alias of entity.aliases) {
            this.aliasIndex.set(normalizeName(alias), entity.id);
        }
    }
}
