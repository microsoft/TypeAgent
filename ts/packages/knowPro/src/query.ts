// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createTopNList } from "typeagent";
import {
    ITermToSemanticRefIndex,
    ScoredSemanticRef,
    SemanticRef,
    SemanticRefIndex,
} from "./dataFormat.js";

// Query eval expressions

export interface IQueryOpExpr<T> {
    eval(context: QueryEvalContext): T;
}

export class QueryEvalContext {
    constructor() {}
}

export class MapExpr<TIn, TOut> implements IQueryOpExpr<TOut> {
    constructor(
        public sourceExpr: IQueryOpExpr<TIn>,
        public mapFn: (value: TIn) => TOut,
    ) {}

    public eval(context: QueryEvalContext): TOut {
        return this.mapFn(this.sourceExpr.eval(context));
    }
}

export class SelectTopNExpr<T extends MatchAccumulator>
    implements IQueryOpExpr<T>
{
    constructor(
        public sourceExpr: IQueryOpExpr<T>,
        public maxMatches: number | undefined = undefined,
        public minHitCount: number | undefined = undefined,
    ) {}

    public eval(context: QueryEvalContext): T {
        const matches = this.sourceExpr.eval(context);
        const topN = matches.getTopNScoring(this.maxMatches, this.minHitCount);
        matches.clearMatches();
        matches.setMatches(topN);
        return matches;
    }
}

export class TermsMatchExpr implements IQueryOpExpr<SemanticRefAccumulator> {
    constructor(
        public index: ITermToSemanticRefIndex,
        public terms: string[],
        predicate?: (match: SemanticRef) => boolean,
    ) {}

    public eval(context: QueryEvalContext): SemanticRefAccumulator {
        const matches = new SemanticRefAccumulator();
        for (const term of this.terms) {
            const postings = this.index.lookupTerm(term);
            if (postings && postings.length > 0) {
                matches.add(postings, term);
            }
        }
        return matches;
    }
}

export interface Match<T = any> {
    value: T;
    score: number;
    hitCount: number;
}

/**
 * Sort in place
 * @param matches
 */
export function sortMatchesByRelevance(matches: Match[]) {
    matches.sort((x, y) => y.score - x.score);
}

export class MatchAccumulator<T = any> {
    private matches: Map<T, Match<T>>;

    constructor() {
        this.matches = new Map<T, Match<T>>();
    }

    public get numMatches(): number {
        return this.matches.size;
    }

    public getMatch(value: T): Match<T> | undefined {
        return this.matches.get(value);
    }

    public addMatch(item: T, score: number) {
        let match = this.matches.get(item);
        if (match) {
            match.hitCount += 1;
            match.score += match.score;
        } else {
            match = {
                value: item,
                score,
                hitCount: 1,
            };
            this.matches.set(item, match);
        }
    }

    public getSortedByScore(minHitCount?: number): Match<T>[] {
        if (this.matches.size === 0) {
            return [];
        }
        const matches = [...this.matchesWithMinHitCount(minHitCount)];
        matches.sort((x, y) => y.score - x.score);
        return matches;
    }

    /**
     * Return the top N scoring matches
     * @param maxMatches
     * @returns
     */
    public getTopNScoring(
        maxMatches?: number,
        minHitCount?: number,
    ): Match<T>[] {
        if (this.matches.size === 0) {
            return [];
        }
        if (maxMatches && maxMatches > 0) {
            const topList = createTopNList<T>(maxMatches);
            for (const match of this.matchesWithMinHitCount(minHitCount)) {
                topList.push(match.value, match.score);
            }
            const ranked = topList.byRank();
            return ranked.map((m) => this.matches.get(m.item)!);
        } else {
            return this.getSortedByScore(minHitCount);
        }
    }

    public getMatches(): IterableIterator<Match<T>> {
        return this.matches.values();
    }

    public *getMatchesWhere(
        predicate: (match: Match<T>) => boolean,
    ): IterableIterator<Match<T>> {
        for (const match of this.matches.values()) {
            if (predicate(match)) {
                yield match;
            }
        }
    }

    public removeMatchesWhere(predicate: (match: Match<T>) => boolean): void {
        const valuesToRemove: T[] = [];
        for (const match of this.getMatchesWhere(predicate)) {
            valuesToRemove.push(match.value);
        }
        this.removeMatches(valuesToRemove);
    }

    public removeMatches(valuesToRemove: T[]): void {
        if (valuesToRemove.length > 0) {
            for (const item of valuesToRemove) {
                this.matches.delete(item);
            }
        }
    }

    public clearMatches(): void {
        this.matches.clear();
    }

    public setMatches(matches: Match<T>[] | IterableIterator<Match<T>>): void {
        for (const match of matches) {
            this.matches.set(match.value, match);
        }
    }

    public mapMatches<M = any>(map: (m: Match<T>) => M): M[] {
        const items: M[] = [];
        for (const match of this.matches.values()) {
            items.push(map(match));
        }
        return items;
    }

    private matchesWithMinHitCount(
        minHitCount: number | undefined,
    ): IterableIterator<Match<T>> {
        return minHitCount !== undefined && minHitCount > 0
            ? this.getMatchesWhere((m) => m.hitCount >= minHitCount)
            : this.matches.values();
    }
}

export class SemanticRefAccumulator extends MatchAccumulator<SemanticRefIndex> {
    private terms: Set<string>;

    constructor(matches?: IterableIterator<ScoredSemanticRef>) {
        super();
        this.terms = new Set();
        if (matches) {
            for (const match of matches) {
                this.add(match);
            }
        }
    }

    public add(
        matches: ScoredSemanticRef | ScoredSemanticRef[],
        term?: string,
    ) {
        if (Array.isArray(matches)) {
            for (const match of matches) {
                this.addMatch(match.semanticRefIndex, match.score);
            }
        } else {
            this.addMatch(matches.semanticRefIndex, matches.score);
        }
        if (term) {
            this.terms.add(term);
        }
    }

    public override getSortedByScore(
        minHitCount?: number,
    ): Match<SemanticRefIndex>[] {
        return super.getSortedByScore(this.getMinHitCount(minHitCount));
    }

    public override getTopNScoring(
        maxMatches?: number,
        minHitCount?: number,
    ): Match<SemanticRefIndex>[] {
        return super.getTopNScoring(
            maxMatches,
            this.getMinHitCount(minHitCount),
        );
    }

    public getTerms(): Set<string> {
        return this.terms;
    }

    public toScoredSemanticRefs(): ScoredSemanticRef[] {
        return this.getSortedByScore(0).map((m) => {
            return {
                semanticRefIndex: m.value,
                score: m.score,
            };
        }, 0);
    }

    private getMinHitCount(minHitCount?: number): number {
        return minHitCount !== undefined ? minHitCount : this.terms.size;
    }
}
