// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Entity, RecallResult, TrustTier, trustTierRank } from "./model.js";
import { RdfStore } from "./rdfStore.js";
import { SignalStore } from "./signalStore.js";
import { EntityResolver } from "./resolver.js";
import {
    CLASS_ENTITY,
    CLASS_RELATION,
    P_ASSERTS,
    P_ENTITY_TYPE,
    P_NAME,
    P_OBJECT,
    P_PREDICATE_LABEL,
    P_SUBJECT,
    P_TIER,
    RDF_TYPE,
} from "./vocab.js";

// Recall: retrieve the relations most relevant to a query, ranked by a blend of
// lexical match and live decay weight.
//
// SECURITY: user query text is NEVER interpolated into SPARQL. We pull the
// candidate relation set with a fixed query and do all keyword matching in JS.

export type RecallOptions = {
    /** Maximum number of results to return. */
    topK?: number | undefined;
    /** Evaluation time for decay (epoch ms). Defaults to now. */
    now?: number | undefined;
    /** Weight of lexical match vs. decay strength in the final score. */
    lexicalWeight?: number | undefined;
    /**
     * Minimum edit similarity in [0, 1] for a fuzzy (typo-tolerant) word match.
     * Defaults to {@link DEFAULT_FUZZY_THRESHOLD}. Set to 1 to require exact
     * substring matches only.
     */
    fuzzyThreshold?: number | undefined;
};

const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "at",
    "for",
    "is",
    "are",
    "was",
    "were",
    "who",
    "what",
    "when",
    "where",
    "which",
    "did",
    "do",
    "does",
    "with",
    "by",
    "about",
    "that",
    "this",
]);

/** Split a query into lowercase content tokens. */
export function tokenize(query: string): string[] {
    return query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Generate singular/plural variants of a token so that query words like
 * "books" or "movies" can match stored entity types like "book" / "movie".
 * Spurious variants are harmless: they only count if they match a real type.
 */
export function typeCandidates(token: string): string[] {
    const t = token.toLowerCase();
    const out = new Set<string>([t]);
    if (t.endsWith("ies") && t.length > 3) {
        out.add(t.slice(0, -3) + "y");
    }
    if (t.endsWith("es") && t.length > 2) {
        out.add(t.slice(0, -2));
    }
    if (t.endsWith("s") && t.length > 1) {
        out.add(t.slice(0, -1));
    }
    out.add(t + "s");
    return [...out];
}

/**
 * Detect an explicit set-intersection cue in a raw query ("also" / "both"),
 * which distinguishes "books that are also movies" (intersection) from
 * "books and movies" (union). Without such a cue, multi-type queries union.
 */
export function hasIntersectionCue(query: string): boolean {
    return /\b(?:also|both)\b/i.test(query);
}

/** Default minimum edit similarity for a fuzzy (typo-tolerant) word match. */
export const DEFAULT_FUZZY_THRESHOLD = 0.8;

/**
 * Levenshtein edit distance between two strings. Pure, with O(a.length *
 * b.length) time and O(b.length) space (rolling two-row DP).
 */
export function levenshtein(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    if (a.length === 0) {
        return b.length;
    }
    if (b.length === 0) {
        return a.length;
    }
    let prev = new Array<number>(b.length + 1);
    for (let j = 0; j <= b.length; j++) {
        prev[j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
        const curr = new Array<number>(b.length + 1);
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1, // deletion
                curr[j - 1] + 1, // insertion
                prev[j - 1] + cost, // substitution
            );
        }
        prev = curr;
    }
    return prev[b.length];
}

/**
 * Normalized edit similarity in [0, 1]: 1 - distance / maxLength. 1.0 means
 * identical; 0 means maximally different.
 */
export function editSimilarity(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) {
        return 1;
    }
    return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Score how well query keywords match a haystack string, tolerating typos.
 * Each keyword contributes up to 1.0 to the returned sum:
 *   - an exact substring hit contributes 1.0 (preserves prior behavior, so a
 *     keyword like "child" still matches "children");
 *   - otherwise the best per-word edit similarity, if it meets `threshold`,
 *     contributes that similarity (e.g. "tchaikovski" ~ "tchaikovsky").
 * A keyword that neither matches as a substring nor clears the threshold
 * contributes nothing.
 */
export function fuzzyLexicalScore(
    keywords: string[],
    haystack: string,
    threshold = DEFAULT_FUZZY_THRESHOLD,
): number {
    if (keywords.length === 0) {
        return 0;
    }
    const words = haystack.split(/\s+/).filter((w) => w.length > 0);
    let total = 0;
    for (const keyword of keywords) {
        if (haystack.includes(keyword)) {
            total += 1;
            continue;
        }
        let best = 0;
        for (const word of words) {
            const sim = editSimilarity(keyword, word);
            if (sim > best) {
                best = sim;
            }
        }
        if (best >= threshold) {
            total += best;
        }
    }
    return total;
}

type RelationRow = {
    rel: string;
    subjectId: string;
    subjectName: string;
    predicate: string;
    objectId: string;
    objectName: string;
};

type EntityTypeRow = {
    entityId: string;
    name: string;
    type: string;
};

export class Recall {
    constructor(
        private readonly rdf: RdfStore,
        private readonly signals: SignalStore,
        private readonly resolver?: EntityResolver,
    ) {}

    /** Retrieve and rank relations relevant to the query. */
    recall(query: string, options: RecallOptions = {}): RecallResult[] {
        const topK = options.topK ?? 10;
        const now = options.now ?? Date.now();
        const lexicalWeight = options.lexicalWeight ?? 1;
        const fuzzyThreshold =
            options.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD;
        const keywords = tokenize(query);

        const rows = this.fetchRelations();
        const scored: { result: RecallResult; score: number }[] = [];

        for (const row of rows) {
            const haystack =
                `${row.subjectName} ${row.predicate.replace(/_/g, " ")} ${row.objectName}`.toLowerCase();
            const lexical = fuzzyLexicalScore(
                keywords,
                haystack,
                fuzzyThreshold,
            );

            // When the caller supplied keywords, require at least one hit.
            if (keywords.length > 0 && lexical === 0) {
                continue;
            }

            const signal = this.signals.getWeight(row.rel, now);
            const weight = signal?.weight ?? 0;
            const score = lexicalWeight * lexical + weight;

            scored.push({
                result: {
                    relation: {
                        id: row.rel,
                        subjectId: row.subjectId,
                        predicate: row.predicate,
                        objectId: row.objectId,
                    },
                    subject: this.entity(row.subjectId, row.subjectName),
                    object: this.entity(row.objectId, row.objectName),
                    tier: this.relationTier(row.rel),
                    weight,
                },
                score,
            });
        }

        // Type-aggregation path: when query keywords name known entity types
        // (e.g. "books" -> type "book"), surface matching entities as synthetic
        // "is_a" facts so list/aggregate questions can be answered. Multi-type
        // queries union by default, but intersect when the query carries an
        // explicit cue ("books that are also movies").
        const intersectionCue = hasIntersectionCue(query);
        for (const result of this.recallEntitiesByType(
            keywords,
            intersectionCue,
        )) {
            scored.push({ result, score: lexicalWeight + 1 });
        }

        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, topK);
        for (const { result } of top) {
            this.signals.touch(result.relation.id);
        }
        return top.map((s) => s.result);
    }

    private fetchRelations(): RelationRow[] {
        const rows = this.rdf.select(
            `SELECT ?rel ?s ?sname ?pred ?o ?oname WHERE {
                ?rel <${RDF_TYPE}> <${CLASS_RELATION}> ;
                     <${P_SUBJECT}> ?s ;
                     <${P_PREDICATE_LABEL}> ?pred ;
                     <${P_OBJECT}> ?o .
                ?s <${P_NAME}> ?sname .
                ?o <${P_NAME}> ?oname .
            }`,
        );
        return rows.map((r) => ({
            rel: r.get("rel") ?? "",
            subjectId: r.get("s") ?? "",
            subjectName: r.get("sname") ?? "",
            predicate: r.get("pred") ?? "",
            objectId: r.get("o") ?? "",
            objectName: r.get("oname") ?? "",
        }));
    }

    /**
     * Return entities whose declared type(s) match query keywords, as synthetic
     * "is_a" relations. Operates in two modes:
     *  - UNION (default): every entity matching any named type is surfaced.
     *  - INTERSECTION: when the query names >= 2 distinct stored types *and*
     *    `intersectionCue` is set, only entities carrying ALL named types are
     *    surfaced (e.g. "books that are also movies").
     *
     * SECURITY: query text is matched in JS against a fixed-query result set;
     * it is never interpolated into SPARQL.
     */
    private recallEntitiesByType(
        keywords: string[],
        intersectionCue: boolean,
    ): RecallResult[] {
        if (keywords.length === 0) {
            return [];
        }
        const candidates = new Set<string>();
        for (const keyword of keywords) {
            for (const candidate of typeCandidates(keyword)) {
                candidates.add(candidate);
            }
        }

        // Group each entity's declared types and record the distinct stored
        // types the query actually named (with their original display form).
        const byEntity = new Map<
            string,
            { name: string; types: Set<string> }
        >();
        const typeDisplay = new Map<string, string>();
        const namedTypes = new Set<string>();
        for (const row of this.fetchEntityTypes()) {
            const type = row.type.toLowerCase();
            let rec = byEntity.get(row.entityId);
            if (rec === undefined) {
                rec = { name: row.name, types: new Set<string>() };
                byEntity.set(row.entityId, rec);
            }
            rec.types.add(type);
            if (candidates.has(type)) {
                namedTypes.add(type);
                typeDisplay.set(type, row.type);
            }
        }
        if (namedTypes.size === 0) {
            return [];
        }

        // Intersection only applies to multi-type queries with an explicit cue;
        // otherwise multi-type queries (e.g. "books and movies") union.
        const intersect = intersectionCue && namedTypes.size >= 2;

        const results: RecallResult[] = [];
        for (const [entityId, rec] of byEntity) {
            const matched = [...namedTypes].filter((t) => rec.types.has(t));
            if (matched.length === 0) {
                continue;
            }
            if (intersect && matched.length < namedTypes.size) {
                continue; // entity is missing one of the named types
            }
            for (const type of matched) {
                results.push(
                    this.makeIsAResult(
                        entityId,
                        rec.name,
                        typeDisplay.get(type) ?? type,
                        type,
                    ),
                );
            }
        }
        return results;
    }

    /** Build a synthetic "is_a" recall result linking an entity to a type. */
    private makeIsAResult(
        entityId: string,
        name: string,
        typeDisplay: string,
        typeLower: string,
    ): RecallResult {
        const typeId = `urn:rem:type:${encodeURIComponent(typeLower)}`;
        return {
            relation: {
                id: `${entityId}#isa#${encodeURIComponent(typeLower)}`,
                subjectId: entityId,
                predicate: "is_a",
                objectId: typeId,
            },
            subject: this.entity(entityId, name),
            object: {
                id: typeId,
                name: typeDisplay,
                aliases: [typeDisplay],
                types: [],
                facets: [],
            },
            tier: TrustTier.ExtractorInferred,
            weight: 1,
        };
    }

    private fetchEntityTypes(): EntityTypeRow[] {
        const rows = this.rdf.select(
            `SELECT ?e ?name ?type WHERE {
                ?e <${RDF_TYPE}> <${CLASS_ENTITY}> ;
                   <${P_NAME}> ?name ;
                   <${P_ENTITY_TYPE}> ?type .
            }`,
        );
        return rows.map((r) => ({
            entityId: r.get("e") ?? "",
            name: r.get("name") ?? "",
            type: r.get("type") ?? "",
        }));
    }

    /** Resolve the highest trust tier backing a relation from provenance graphs. */
    private relationTier(relationId: string): TrustTier {
        const rows = this.rdf.select(
            `SELECT ?tier WHERE {
                GRAPH ?g {
                    ?g <${P_ASSERTS}> <${relationId}> ;
                       <${P_TIER}> ?tier .
                }
            }`,
        );
        let best: TrustTier = TrustTier.ExternalInferred;
        let bestRank = -1;
        for (const row of rows) {
            const tier = row.get("tier") as TrustTier | undefined;
            if (tier === undefined) {
                continue;
            }
            const rank = trustTierRank(tier);
            if (rank > bestRank) {
                bestRank = rank;
                best = tier;
            }
        }
        return best;
    }

    private entity(id: string, name: string): Entity {
        const known = this.resolver?.get(id);
        if (known !== undefined) {
            return known;
        }
        return { id, name, aliases: [name], types: [], facets: [] };
    }
}
