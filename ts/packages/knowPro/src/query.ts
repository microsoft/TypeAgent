// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collections, createTopNList } from "typeagent";
import {
    IConversation,
    IMessage,
    ITermToRelatedTermsIndex,
    ITermToSemanticRefIndex,
    KnowledgeType,
    QueryTerm,
    ScoredSemanticRef,
    SemanticRef,
    SemanticRefIndex,
    Term,
} from "./dataFormat.js";
import * as knowLib from "knowledge-processor";

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

    public getSemanticRef(semanticRefIndex: SemanticRefIndex): SemanticRef {
        return this.semanticRefs[semanticRefIndex];
    }

    public getMessageForRef(semanticRef: SemanticRef): IMessage {
        const messageIndex = semanticRef.range.start.messageIndex;
        return this.conversation.messages[messageIndex];
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
    constructor(public terms: IQueryOpExpr<QueryTerm[]>) {}

    public async eval(
        context: QueryEvalContext,
    ): Promise<SemanticRefAccumulator> {
        const matchAccumulator: SemanticRefAccumulator =
            new SemanticRefAccumulator();
        const index = context.semanticRefIndex;
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
                    relatedTerm,
                    index.lookupTerm(relatedTerm.text),
                    relatedTerm.score,
                );
            }
        }
    }
}

export class ResolveRelatedTermsExpr implements IQueryOpExpr<QueryTerm[]> {
    constructor(public terms: IQueryOpExpr<QueryTerm[]>) {}

    public async eval(context: QueryEvalContext): Promise<QueryTerm[]> {
        const terms = await this.terms.eval(context);
        const index = context.relatedTermIndex;
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

export class WhereSemanticRefExpr
    implements IQueryOpExpr<SemanticRefAccumulator>
{
    constructor(
        public sourceExpr: IQueryOpExpr<SemanticRefAccumulator>,
        public predicates: IQueryOpPredicate[],
    ) {}

    public async eval(
        context: QueryEvalContext,
    ): Promise<SemanticRefAccumulator> {
        const accumulator = await this.sourceExpr.eval(context);
        const filtered = new SemanticRefAccumulator(
            accumulator.queryTermMatches,
        );
        filtered.setMatches(
            accumulator.getMatchesWhere((match) =>
                this.testOr(context, accumulator.queryTermMatches, match),
            ),
        );
        return filtered;
    }

    private testOr(
        context: QueryEvalContext,
        queryTermMatches: QueryTermAccumulator,
        match: Match<SemanticRefIndex>,
    ) {
        for (let i = 0; i < this.predicates.length; ++i) {
            const semanticRef = context.getSemanticRef(match.value);
            if (
                this.predicates[i].eval(context, queryTermMatches, semanticRef)
            ) {
                return true;
            }
        }
        return false;
    }
}

export interface IQueryOpPredicate {
    eval(
        context: QueryEvalContext,
        termMatches: QueryTermAccumulator,
        semanticRef: SemanticRef,
    ): boolean;
}

export class EntityPredicate implements IQueryOpPredicate {
    constructor(
        public type: string | undefined,
        public name: string | undefined,
        public facetName: string | undefined,
    ) {}

    public eval(
        context: QueryEvalContext,
        termMatches: QueryTermAccumulator,
        semanticRef: SemanticRef,
    ): boolean {
        if (semanticRef.knowledgeType !== "entity") {
            return false;
        }
        const entity =
            semanticRef.knowledge as knowLib.conversation.ConcreteEntity;
        return (
            isPropertyMatch(termMatches, entity.type, this.type) &&
            isPropertyMatch(termMatches, entity.name, this.name) &&
            this.matchFacet(termMatches, entity, this.facetName)
        );
    }

    private matchFacet(
        termMatches: QueryTermAccumulator,
        entity: knowLib.conversation.ConcreteEntity,
        facetName?: string | undefined,
    ): boolean {
        if (facetName === undefined || entity.facets === undefined) {
            return false;
        }
        for (const facet of entity.facets) {
            if (isPropertyMatch(termMatches, facet.name, facetName)) {
                return true;
            }
        }
        return false;
    }
}

export class ActionPredicate implements IQueryOpPredicate {
    constructor(
        public subjectEntityName?: string | undefined,
        public objectEntityName?: string | undefined,
    ) {}

    public eval(
        context: QueryEvalContext,
        termMatches: QueryTermAccumulator,
        semanticRef: SemanticRef,
    ): boolean {
        if (semanticRef.knowledgeType !== "action") {
            return false;
        }
        const action = semanticRef.knowledge as knowLib.conversation.Action;
        return (
            isPropertyMatch(
                termMatches,
                action.subjectEntityName,
                this.subjectEntityName,
            ) &&
            isPropertyMatch(
                termMatches,
                action.objectEntityName,
                this.objectEntityName,
            )
        );
    }
}

function isPropertyMatch(
    termMatches: QueryTermAccumulator,
    testText: string | string[] | undefined,
    expectedText: string | undefined,
) {
    if (testText !== undefined && expectedText !== undefined) {
        return termMatches.matched(testText, expectedText);
    }
    return testText === undefined && expectedText === undefined;
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
    private maxHitCount: number;

    constructor() {
        this.matches = new Map<T, Match<T>>();
        this.maxHitCount = 0;
    }

    public get numMatches(): number {
        return this.matches.size;
    }

    public get maxHits(): number {
        return this.maxHitCount;
    }

    public getMatch(value: T): Match<T> | undefined {
        return this.matches.get(value);
    }

    public setMatch(match: Match<T>): void {
        this.matches.set(match.value, match);
        if (match.hitCount > this.maxHitCount) {
            this.maxHitCount = match.hitCount;
        }
    }

    public setMatches(matches: Match<T>[] | IterableIterator<Match<T>>): void {
        for (const match of matches) {
            this.setMatch(match);
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
        if (match.hitCount > this.maxHitCount) {
            this.maxHitCount = match.hitCount;
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

    public clearMatches(): void {
        this.matches.clear();
        this.maxHitCount = 0;
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
    constructor(public queryTermMatches = new QueryTermAccumulator()) {
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
            this.queryTermMatches.add(term);
        }
    }

    public addRelatedTermMatch(
        primaryTerm: Term,
        relatedTerm: Term,
        semanticRefs: ScoredSemanticRef[] | undefined,
        scoreBoost?: number,
    ) {
        if (semanticRefs) {
            // Related term matches count as matches for the queryTerm...
            // BUT are scored with the score of the related term
            scoreBoost ??= relatedTerm.score ?? 0;
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
            this.queryTermMatches.add(primaryTerm, relatedTerm);
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

    public groupMatchesByKnowledgeType(
        semanticRefs: SemanticRef[],
    ): Map<KnowledgeType, SemanticRefAccumulator> {
        const groups = new Map<KnowledgeType, SemanticRefAccumulator>();
        for (const match of this.getMatches()) {
            const semanticRef = semanticRefs[match.value];
            let group = groups.get(semanticRef.knowledgeType);
            if (group === undefined) {
                group = new SemanticRefAccumulator();
                group.queryTermMatches = this.queryTermMatches;
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
        return minHitCount !== undefined
            ? minHitCount
            : //: this.queryTermMatches.termMatches.size;
              this.maxHits;
    }
}

export class QueryTermAccumulator {
    constructor(
        public termMatches: Set<string> = new Set<string>(),
        public relatedTermToTerms: Map<string, Set<string>> = new Map<
            string,
            Set<string>
        >(),
    ) {}

    public add(term: Term, relatedTerm?: Term) {
        this.termMatches.add(term.text);
        if (relatedTerm !== undefined) {
            let relatedTermToTerms = this.relatedTermToTerms.get(
                relatedTerm.text,
            );
            if (relatedTermToTerms === undefined) {
                relatedTermToTerms = new Set<string>();
                this.relatedTermToTerms.set(
                    relatedTerm.text,
                    relatedTermToTerms,
                );
            }
            relatedTermToTerms.add(term.text);
        }
    }

    public matched(testText: string | string[], expectedText: string): boolean {
        if (Array.isArray(testText)) {
            if (testText.length > 0) {
                for (const text of testText) {
                    if (this.matched(text, expectedText)) {
                        return true;
                    }
                }
            }
            return false;
        }

        if (
            this.termMatches.has(testText) &&
            collections.stringEquals(testText, expectedText, false)
        ) {
            return true;
        }

        // Maybe the test text matched a related term.
        // If so, the matching related term should have matched *on behalf* of
        // of expectedTerm
        const relatedTermToTerms = this.relatedTermToTerms.get(testText);
        return relatedTermToTerms !== undefined
            ? relatedTermToTerms.has(expectedText)
            : false;
    }

    public didValueMatch(
        obj: Record<string, any>,
        key: string,
        expectedValue: string,
    ): boolean {
        const value = obj[key];
        if (value === undefined) {
            return false;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                if (this.didValueMatch(item, key, expectedValue)) {
                    return true;
                }
            }
            return false;
        } else {
            const stringValue = value.toString().toLowerCase();
            return this.matched(stringValue, expectedValue);
        }
    }
}
