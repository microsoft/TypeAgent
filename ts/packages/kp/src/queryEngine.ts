// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    QueryPlan,
    SearchResult,
    ScoredChunkResult,
    IInvertedIndex,
    IRelatedTermsMap,
    IMetadataIndex,
    IGroupIndex,
    MetadataFilter,
} from "./types.js";

import registerDebug from "debug";
const debug = registerDebug("kp:query");

/**
 * Query engine: executes a QueryPlan against the indexes.
 *
 * The inverted index and related terms map already store lemmatized terms
 * (lemmatization happens once during batch index building).
 * The QueryPlan's search terms are already lemmatized by the LLM that
 * generated the plan. So no runtime lemmatization is needed here.
 */
export class QueryEngine {
    constructor(
        private invertedIndex: IInvertedIndex,
        private relatedTerms: IRelatedTermsMap,
        private metadataIndex: IMetadataIndex,
        private groupIndex: IGroupIndex,
    ) {}

    execute(plan: QueryPlan): SearchResult {
        const maxResults = plan.maxResults ?? 20;
        const matchedTerms: string[] = [];
        const expandedTermsMap = new Map<string, string[]>();

        debug("Executing query plan: %O", plan);

        // Step 1: Metadata filtering — narrow to candidate chunk IDs
        let metadataCandidates: Set<number> | undefined;
        if (plan.metadataFilters && plan.metadataFilters.length > 0) {
            metadataCandidates = this.applyMetadataFilters(
                plan.metadataFilters,
            );
            debug(
                "Metadata filters matched %d chunks",
                metadataCandidates.size,
            );
        }

        // Step 2: Time range / group filtering
        let groupCandidates: Set<number> | undefined;
        if (plan.timeRange) {
            const groups = this.groupIndex.getGroupsInTimeRange(
                plan.timeRange,
            );
            if (groups.length > 0) {
                groupCandidates = this.groupIndex.getChunkIdsForGroups(
                    groups.map((g) => g.groupId),
                );
                debug(
                    "Time range matched %d groups, %d chunks",
                    groups.length,
                    groupCandidates.size,
                );
            }
        }
        if (plan.groupFilters && plan.groupFilters.length > 0) {
            for (const gf of plan.groupFilters) {
                let groups = this.groupIndex.getAllGroups();
                if (gf.groupType) {
                    groups = groups.filter(
                        (g) => g.groupType === gf.groupType,
                    );
                }
                if (gf.label) {
                    const sub = gf.label.toLowerCase();
                    groups = groups.filter(
                        (g) =>
                            g.label &&
                            g.label.toLowerCase().includes(sub),
                    );
                }
                if (groups.length > 0) {
                    const ids = this.groupIndex.getChunkIdsForGroups(
                        groups.map((g) => g.groupId),
                    );
                    if (groupCandidates) {
                        // Intersect
                        for (const id of groupCandidates) {
                            if (!ids.has(id)) groupCandidates.delete(id);
                        }
                    } else {
                        groupCandidates = ids;
                    }
                }
            }
        }

        // Combine metadata and group candidates (intersection)
        let candidates: Set<number> | undefined;
        if (metadataCandidates && groupCandidates) {
            candidates = new Set<number>();
            for (const id of metadataCandidates) {
                if (groupCandidates.has(id)) candidates.add(id);
            }
        } else {
            candidates = metadataCandidates ?? groupCandidates;
        }

        // Step 3: Term expansion and inverted index lookup
        const termScores = new Map<number, number>(); // chunkId → aggregated score
        const termHitWeights = new Map<number, number>(); // chunkId → sum of matched search term weights

        for (const searchTerm of plan.searchTerms) {
            // Search terms are already lemmatized by the LLM query planner
            const term = searchTerm.term;
            const weight = searchTerm.weight ?? 1.0;

            // Collect all terms to look up (original + related)
            const termsToLookup: { term: string; boost: number }[] = [
                { term, boost: 1.0 },
            ];

            if (searchTerm.expandRelated !== false) {
                const related = this.relatedTerms.lookup(term);
                if (related) {
                    const expandedList: string[] = [];
                    for (const r of related) {
                        const relBoost = r.weight ?? 0.8;
                        termsToLookup.push({
                            term: r.term,
                            boost: relBoost,
                        });
                        expandedList.push(r.term);
                    }
                    expandedTermsMap.set(term, expandedList);
                }
            }

            // Look up each term in the inverted index
            let termMatched = false;
            const hitChunks = new Set<number>();

            for (const { term: lookupTerm, boost } of termsToLookup) {
                const refs = this.invertedIndex.lookupTerm(lookupTerm);
                if (!refs) continue;

                termMatched = true;
                for (const ref of refs) {
                    // Skip if not in candidate set
                    if (candidates && !candidates.has(ref.chunkId)) continue;

                    const score = ref.score * weight * boost;
                    const existing = termScores.get(ref.chunkId) ?? 0;
                    termScores.set(ref.chunkId, existing + score);
                    hitChunks.add(ref.chunkId);
                }
            }

            // Each chunk that this search term matched gets the term's weight
            for (const chunkId of hitChunks) {
                const existing = termHitWeights.get(chunkId) ?? 0;
                termHitWeights.set(chunkId, existing + weight);
            }

            if (termMatched) {
                matchedTerms.push(term);
            }
        }

        // Step 4: Apply combine logic
        let resultChunks: ScoredChunkResult[];

        if (plan.combineOp === "and" && plan.searchTerms.length > 1) {
            // AND: rank by hit weight (breadth) then by term score (depth).
            // Chunks matching more search terms rank higher — no hard filter.
            resultChunks = Array.from(termScores.entries()).map(
                ([chunkId, score]) => {
                    const hitWeight = termHitWeights.get(chunkId) ?? 0;
                    return { chunkId, score: hitWeight * 10 + score };
                },
            );
        } else {
            // OR: all chunks with any match, scored by accumulated term scores
            resultChunks = Array.from(termScores.entries()).map(
                ([chunkId, score]) => ({ chunkId, score }),
            );
        }

        // If we had candidates from metadata/group filters but no search terms,
        // return all candidates with score 1.0
        if (
            plan.searchTerms.length === 0 &&
            candidates &&
            candidates.size > 0
        ) {
            resultChunks = Array.from(candidates).map((chunkId) => ({
                chunkId,
                score: 1.0,
            }));
        }

        // Step 5: Sort by score descending, limit results
        resultChunks.sort((a, b) => b.score - a.score);
        resultChunks = resultChunks.slice(0, maxResults);

        debug(
            "Query returned %d results (considered %d)",
            resultChunks.length,
            termScores.size,
        );

        return {
            chunks: resultChunks,
            matchedTerms,
            expandedTerms: expandedTermsMap,
            totalConsidered: termScores.size || (candidates?.size ?? 0),
        };
    }

    private applyMetadataFilters(
        filters: MetadataFilter[],
    ): Set<number> {
        let result: Set<number> | undefined;

        for (const filter of filters) {
            let matches: Set<number> | undefined;

            switch (filter.op) {
                case "equals":
                    matches = this.metadataIndex.lookup(
                        filter.column,
                        filter.value,
                    );
                    break;
                case "contains":
                    matches = this.metadataIndex.lookupContains(
                        filter.column,
                        filter.value,
                    );
                    break;
                case "domain":
                    matches = this.metadataIndex.lookupDomain(
                        filter.column,
                        filter.value,
                    );
                    break;
            }

            if (matches) {
                if (result) {
                    // Intersect
                    for (const id of result) {
                        if (!matches.has(id)) result.delete(id);
                    }
                } else {
                    result = new Set(matches);
                }
            } else {
                // No matches for this filter — intersection is empty
                return new Set();
            }
        }

        return result ?? new Set();
    }

    /**
     * Get all groups from the group index.
     * Convenience for the caller to populate search results with group info.
     */
    getAllGroups() {
        return this.groupIndex;
    }
}
