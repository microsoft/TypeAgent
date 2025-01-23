// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mathLib, TopNCollection } from "typeagent";
import {
    ITermToSemanticRefIndex,
    ScoredSemanticRef,
    SemanticRefIndex,
} from "./dataFormat.js";

export class SearchResult {
    constructor(
        public matchedTerms: string[] = [],
        public matchedSemanticRefs: ScoredSemanticRef[] = [],
    ) {}

    public get hasMatches(): boolean {
        return this.matchedTerms.length > 0;
    }
}

export function searchTermsInIndex(
    semanticRefIndex: ITermToSemanticRefIndex,
    terms: string[],
    maxMatches?: number,
): SearchResult {
    const [matchedTerms, matchTable] = matchTermsInIndex(
        semanticRefIndex,
        terms,
    );
    if (matchTable.numMatches <= 0) {
        return new SearchResult();
    }

    const minHitCount = matchedTerms.length;
    return new SearchResult(
        matchedTerms,
        matchTable.getTopNScoring(maxMatches, minHitCount),
    );
}

function matchTermsInIndex(
    semanticRefIndex: ITermToSemanticRefIndex,
    terms: string[],
): [string[], MatchTable] {
    const matchedTerms: string[] = [];
    const matchTable = new MatchTable();
    for (const term of terms) {
        const scoredRefs = semanticRefIndex.lookupTerm(term);
        if (scoredRefs) {
            matchedTerms.push(term);
            matchTable.add(scoredRefs);
        }
    }
    return [matchedTerms, matchTable];
}

class MatchTable {
    constructor(public matches = new Map<SemanticRefIndex, Match>()) {}

    public get numMatches(): number {
        return this.matches.size;
    }

    public get(refIndex: SemanticRefIndex): Match | undefined {
        return this.matches.get(refIndex);
    }

    public add(matches: ScoredSemanticRef | ScoredSemanticRef[]) {
        if (Array.isArray(matches)) {
            for (const match of matches) {
                this.addMatch(match);
            }
        } else {
            this.addMatch(matches);
        }
    }

    private addMatch(match: ScoredSemanticRef) {
        let hit = this.matches.get(match.semanticRefIndex);
        if (hit) {
            hit.hitCount += 1;
            hit.score += match.score;
        } else {
            hit = {
                semanticRefIndex: match.semanticRefIndex,
                hitCount: 1,
                score: match.score,
            };
            this.matches.set(match.semanticRefIndex, hit);
        }
    }

    public getSortedByScore(minHitCount = 0): ScoredSemanticRef[] {
        if (this.matches.size === 0) {
            return [];
        }
        const matchesIterator =
            minHitCount > 0
                ? this.filterMatches((match) => match.hitCount >= minHitCount)
                : this.matches.values();

        const matches = [...matchesIterator];
        matches.sort((x, y) => y.score - x.score);
        return matches;
    }

    /**
     * Return all matches with the 'top' or maximum score.
     * @returns
     */
    public getTopScoring(): ScoredSemanticRef[] {
        if (this.matches.size === 0) {
            return [];
        }
        let maxScore = mathLib.max(
            this.matches.values(),
            (v) => v.score,
        )!.score;
        return [...this.filterMatches((match) => match.score === maxScore)];
    }

    /**
     * Return the top N scoring matches
     * @param maxMatches
     * @returns
     */
    public getTopNScoring(
        maxMatches?: number,
        minHitCount = 0,
    ): ScoredSemanticRef[] {
        if (this.matches.size === 0) {
            return [];
        }
        if (maxMatches) {
            const topList = new TopNCollection(maxMatches, -1);
            for (const hit of this.matches.values()) {
                if (hit.hitCount >= minHitCount) {
                    topList.push(hit.semanticRefIndex, hit.score);
                }
            }
            const ranked = topList.byRank();
            return ranked.map((m) => {
                return {
                    semanticRefIndex: m.item,
                    score: m.score,
                };
            });
        } else {
            return this.getSortedByScore(minHitCount);
        }
    }

    public *filterMatches(
        predicate: (match: Match) => boolean,
    ): IterableIterator<Match> {
        for (const match of this.matches.values()) {
            if (predicate(match)) {
                yield match;
            }
        }
    }
}

type Match = {
    semanticRefIndex: SemanticRefIndex;
    hitCount: number;
    score: number;
};
