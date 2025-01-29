// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createTopNList } from "typeagent";
import {
    IConversation,
    ITermToRelatedTermsIndex,
    ITermToSemanticRefIndex,
    KnowledgeType,
    ScoredSemanticRef,
    SemanticRef,
    SemanticRefIndex,
    Term,
} from "./dataFormat.js";

export function isConversationSearchable(conversation: IConversation): boolean {
    return (
        conversation.semanticRefIndex !== undefined &&
        conversation.semanticRefs !== undefined
    );
}

// Query eval expressions

export interface IQueryOpExpr<T> {
    eval(context: QueryEvalContext): Promise<T>;
}

export type QueryTerm = {
    term: Term;
    /**
     * These can be supplied from fuzzy synonym tables and so on
     */
    relatedTerms?: Term[] | undefined;
};

export class QueryEvalContext {
    constructor(private conversation: IConversation) {
        if (!isConversationSearchable(conversation)) {
            throw new Error(`${conversation.nameTag} is not initialized`);
        }
    }

    public get semanticRefIndex(): ITermToSemanticRefIndex {
        return this.conversation.semanticRefIndex!;
    }
    public get semanticRefs(): SemanticRef[] {
        return this.conversation.semanticRefs!;
    }
    public get relatedTermIndex(): ITermToRelatedTermsIndex | undefined {
        return this.conversation.relatedTermsIndex;
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

    public async eval(context: QueryEvalContext): Promise<T> {
        const matches = await this.sourceExpr.eval(context);
        matches.reduceTopNScoring(this.maxMatches, this.minHitCount);
        return Promise.resolve(matches);
    }
}

export class TermsMatchExpr implements IQueryOpExpr<SemanticRefAccumulator> {
    constructor(
        public terms: IQueryOpExpr<QueryTerm[]>,
        public semanticRefIndex?: ITermToSemanticRefIndex,
    ) {}

    public async eval(
        context: QueryEvalContext,
    ): Promise<SemanticRefAccumulator> {
        const matchAccumulator: SemanticRefAccumulator =
            new SemanticRefAccumulator();
        const index = this.semanticRefIndex ?? context.semanticRefIndex;
        const terms = await this.terms.eval(context);
        for (const queryTerm of terms) {
            this.accumulateMatches(index, matchAccumulator, queryTerm);
        }
        return Promise.resolve(matchAccumulator);
    }

    private accumulateMatches(
        index: ITermToSemanticRefIndex,
        matchAccumulator: SemanticRefAccumulator,
        queryTerm: QueryTerm,
    ): void {
        matchAccumulator.addTermMatch(
            queryTerm.term,
            index.lookupTerm(queryTerm.term.text),
        );
        if (queryTerm.relatedTerms && queryTerm.relatedTerms.length > 0) {
            for (const relatedTerm of queryTerm.relatedTerms) {
                // Related term matches count as matches for the queryTerm...
                // BUT are scored with the score of the related term
                matchAccumulator.addRelatedTermMatch(
                    queryTerm.term,
                    index.lookupTerm(relatedTerm.text),
                    relatedTerm.score,
                );
            }
        }
    }
}

export class ResolveRelatedTermsExpr implements IQueryOpExpr<QueryTerm[]> {
    constructor(
        public terms: IQueryOpExpr<QueryTerm[]>,
        public index?: ITermToRelatedTermsIndex,
    ) {}

    public async eval(context: QueryEvalContext): Promise<QueryTerm[]> {
        const terms = await this.terms.eval(context);
        const index = this.index ?? context.relatedTermIndex;
        if (index !== undefined) {
            for (const queryTerm of terms) {
                if (
                    queryTerm.relatedTerms === undefined ||
                    queryTerm.relatedTerms.length === 0
                ) {
                    const relatedTerms = await index.lookupTerm(
                        queryTerm.term.text,
                    );
                    if (relatedTerms !== undefined && relatedTerms.length > 0) {
                        queryTerm.relatedTerms ??= [];
                        queryTerm.relatedTerms.push(...relatedTerms);
                    }
                }
            }
        }
        return terms;
    }
}

export class QueryTermsExpr implements IQueryOpExpr<QueryTerm[]> {
    constructor(public terms: QueryTerm[]) {}

    public eval(context: QueryEvalContext): Promise<QueryTerm[]> {
        return Promise.resolve(this.terms);
    }
}

export class GroupByKnowledgeTypeExpr
    implements IQueryOpExpr<Map<KnowledgeType, SemanticRefAccumulator>>
{
    constructor(public matches: IQueryOpExpr<SemanticRefAccumulator>) {}

    public async eval(
        context: QueryEvalContext,
    ): Promise<Map<KnowledgeType, SemanticRefAccumulator>> {
        const semanticRefMatches = await this.matches.eval(context);
        return semanticRefMatches.groupMatchesByKnowledgeType(
            context.semanticRefs,
        );
    }
}

export class SelectTopNKnowledgeGroupExpr
    implements IQueryOpExpr<Map<KnowledgeType, SemanticRefAccumulator>>
{
    constructor(
        public sourceExpr: IQueryOpExpr<
            Map<KnowledgeType, SemanticRefAccumulator>
        >,
        public maxMatches: number | undefined = undefined,
        public minHitCount: number | undefined = undefined,
    ) {}

    public async eval(
        context: QueryEvalContext,
    ): Promise<Map<KnowledgeType, SemanticRefAccumulator>> {
        const groupsAccumulators = await this.sourceExpr.eval(context);
        for (const accumulator of groupsAccumulators.values()) {
            accumulator.reduceTopNScoring(this.maxMatches, this.minHitCount);
        }
        return groupsAccumulators;
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

    public setMatch(match: Match<T>): void {
        this.matches.set(match.value, match);
    }

    public setMatches(matches: Match<T>[] | IterableIterator<Match<T>>): void {
        for (const match of matches) {
            this.matches.set(match.value, match);
        }
    }

    public add(value: T, score: number): void {
        let match = this.matches.get(value);
        if (match !== undefined) {
            match.hitCount += 1;
            match.score += score;
        } else {
            match = {
                value,
                score,
                hitCount: 1,
            };
            this.matches.set(value, match);
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

    public mapMatches<M = any>(map: (m: Match<T>) => M): M[] {
        const items: M[] = [];
        for (const match of this.matches.values()) {
            items.push(map(match));
        }
        return items;
    }

    public reduceTopNScoring(
        maxMatches?: number,
        minHitCount?: number,
    ): number {
        const topN = this.getTopNScoring(maxMatches, minHitCount);
        this.clearMatches();
        if (topN.length > 0) {
            this.setMatches(topN);
        }
        return topN.length;
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
    constructor(public termMatches: Set<string> = new Set<string>()) {
        super();
    }

    public addTermMatch(
        term: Term,
        semanticRefs: ScoredSemanticRef[] | undefined,
        scoreBoost?: number,
    ) {
        if (semanticRefs) {
            scoreBoost ??= term.score ?? 0;
            for (const match of semanticRefs) {
                this.add(match.semanticRefIndex, match.score + scoreBoost);
            }
            this.recordTermMatch(term.text);
        }
    }

    public addRelatedTermMatch(
        term: Term,
        semanticRefs: ScoredSemanticRef[] | undefined,
        scoreBoost?: number,
    ) {
        if (semanticRefs) {
            scoreBoost ??= term.score ?? 0;
            for (const semanticRef of semanticRefs) {
                let score = semanticRef.score + scoreBoost;
                let match = this.getMatch(semanticRef.semanticRefIndex);
                if (match !== undefined) {
                    if (match.score < score) {
                        match.score = score;
                    }
                } else {
                    match = {
                        value: semanticRef.semanticRefIndex,
                        score,
                        hitCount: 1,
                    };
                    this.setMatch(match);
                }
            }
            this.recordTermMatch(term.text);
        }
    }

    public recordTermMatch(term: string) {
        this.termMatches.add(term);
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

    public groupMatchesByKnowledgeType(
        semanticRefs: SemanticRef[],
    ): Map<KnowledgeType, SemanticRefAccumulator> {
        const groups = new Map<KnowledgeType, SemanticRefAccumulator>();
        for (const match of this.getMatches()) {
            const semanticRef = semanticRefs[match.value];
            let group = groups.get(semanticRef.knowledgeType);
            if (group === undefined) {
                group = new SemanticRefAccumulator();
                group.termMatches = this.termMatches;
                groups.set(semanticRef.knowledgeType, group);
            }
            group.setMatch(match);
        }
        return groups;
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
        return minHitCount !== undefined ? minHitCount : this.termMatches.size;
    }
}
