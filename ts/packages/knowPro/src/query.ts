// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mathLib, TopNCollection } from "typeagent";
import {
    ITermToSemanticRefIndex,
    ScoredSemanticRef,
    SemanticRef,
    SemanticRefIndex,
} from "./dataFormat.js";

// Query eval expressions

export interface IQueryExpr<T = void> {
    eval(context: QueryEvalContext): T;
}

export class QueryEvalContext {
    constructor() {}
}

export type TermMatches = {
    semanticRefMatches: ScoredSemanticRef[];
    termMatches: string[];
};

export class SelectTopTermMatchesExpr implements IQueryExpr<TermMatches> {
    constructor(
        public sourceExpr: IQueryExpr<TermMatchTable>,
        public maxMatches: number | undefined = undefined,
    ) {}

    public eval(context: QueryEvalContext): TermMatches {
        const matches = this.sourceExpr.eval(context);
        return {
            termMatches: matches.termMatches,
            semanticRefMatches: matches.getTopNScoring(
                this.maxMatches,
                matches.termMatches.length,
            ),
        };
    }
}

export class TermsMatchExpr implements IQueryExpr<TermMatchTable> {
    constructor(
        public index: ITermToSemanticRefIndex,
        public terms: string[],
        predicate?: (match: SemanticRef) => boolean,
    ) {}

    public eval(context: QueryEvalContext): TermMatchTable {
        const matches = new TermMatchTable();
        for (const term of this.terms) {
            const postings = this.index.lookupTerm(term);
            if (postings && postings.length > 0) {
                matches.termMatches.push(term);
                matches.add(postings);
            }
        }
        return matches;
    }
}

export class SemanticRefMatchTable {
    public matches: Map<SemanticRefIndex, SemanticRefMatch>;

    constructor(matches?: IterableIterator<ScoredSemanticRef>) {
        this.matches = new Map<SemanticRefIndex, SemanticRefMatch>();
        if (matches) {
            for (const match of matches) {
                this.addMatch(match);
            }
        }
    }

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
        return [...this.getValues((match) => match.score === maxScore)];
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

    public *getValues(
        predicate: (match: SemanticRefMatch) => boolean,
    ): IterableIterator<SemanticRefMatch> {
        for (const match of this.matches.values()) {
            if (predicate(match)) {
                yield match;
            }
        }
    }

    public remove(predicate: (match: SemanticRefMatch) => boolean) {
        const keysToRemove: SemanticRefIndex[] = [];
        for (const match of this.getValues(predicate)) {
            keysToRemove.push(match.semanticRefIndex);
        }
        this.removeKeys(keysToRemove);
    }

    public removeKeys(keysToRemove: SemanticRefIndex[]) {
        if (keysToRemove && keysToRemove.length > 0) {
            for (const key of keysToRemove) {
                this.matches.delete(key);
            }
        }
    }

    private matchesWithMinHitCount(
        minHitCount?: number,
    ): IterableIterator<SemanticRefMatch> {
        return minHitCount && minHitCount > 0
            ? this.getValues((m) => m.hitCount >= minHitCount)
            : this.matches.values();
    }
}

export type SemanticRefMatch = {
    semanticRefIndex: SemanticRefIndex;
    score: number;
    hitCount: number;
};

export class TermMatchTable extends SemanticRefMatchTable {
    public termMatches: string[];
    constructor() {
        super();
        this.termMatches = [];
    }
}
