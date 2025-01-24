// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mathLib, TopNCollection } from "typeagent";
import {
    ITermToSemanticRefIndex,
    ScoredSemanticRef,
    SemanticRefIndex,
} from "./dataFormat.js";

// Query eval expressions

export interface IQueryExpr<T = void> {
    eval(context: QueryEvalContext): T;
}

export class QueryEvalContext {
    constructor() {}
}

export type TermMatches = string[];

export class TermsMatchExpr
    implements IQueryExpr<[TermMatches, SemanticRefMatchTable]>
{
    constructor(
        public index: ITermToSemanticRefIndex,
        public terms: string[],
    ) {}

    public eval(
        context: QueryEvalContext,
    ): [TermMatches, SemanticRefMatchTable] {
        const termsMatches: string[] = [];
        const matches = new SemanticRefMatchTable();
        for (const term of this.terms) {
            const postings = this.index.lookupTerm(term);
            if (postings && postings.length > 0) {
                termsMatches.push(term);
                matches.add(postings);
            }
        }
        return [termsMatches, matches];
    }
}

export class SelectTopNSemanticRefsExpr
    implements IQueryExpr<[TermMatches, ScoredSemanticRef[]]>
{
    constructor(
        public matchExpr: IQueryExpr<[TermMatches, SemanticRefMatchTable]>,
        public maxMatches: number | undefined = undefined,
    ) {}

    public eval(context: QueryEvalContext): [TermMatches, ScoredSemanticRef[]] {
        const [termMatches, matchTable] = this.matchExpr.eval(context);
        return [
            termMatches,
            matchTable.getTopNScoring(this.maxMatches, termMatches.length),
        ];
    }
}

export class SemanticRefMatchTable {
    constructor(
        public matches = new Map<SemanticRefIndex, SemanticRefMatch>(),
    ) {}

    public get numMatches(): number {
        return this.matches.size;
    }

    public get(refIndex: SemanticRefIndex): SemanticRefMatch | undefined {
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
        const matches = [...this.matchesWithMinHitCount(minHitCount)];
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
        if (maxMatches && maxMatches > 0) {
            const topList = new TopNCollection(maxMatches, -1);
            for (const match of this.matchesWithMinHitCount(minHitCount)) {
                topList.push(match.semanticRefIndex, match.score);
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
        predicate: (match: SemanticRefMatch) => boolean,
    ): IterableIterator<SemanticRefMatch> {
        for (const match of this.matches.values()) {
            if (predicate(match)) {
                yield match;
            }
        }
    }

    public matchesWithMinHitCount(
        minHitCount?: number,
    ): IterableIterator<SemanticRefMatch> {
        return minHitCount && minHitCount > 0
            ? this.filterMatches((m) => m.hitCount >= minHitCount)
            : this.matches.values();
    }
}

export type SemanticRefMatch = {
    semanticRefIndex: SemanticRefIndex;
    hitCount: number;
    score: number;
};
