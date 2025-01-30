// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IMessage,
    ITermToRelatedTermsIndex,
    ITermToSemanticRefIndex,
    KnowledgeType,
    QueryTerm,
    SemanticRef,
    SemanticRefIndex,
    TextLocation,
    TextRange,
} from "./dataFormat.js";
import * as knowLib from "knowledge-processor";
import {
    Match,
    MatchAccumulator,
    QueryTermAccumulator,
    SemanticRefAccumulator,
    TextRangeAccumulator,
} from "./accumulators.js";
import { collections, dateTime } from "typeagent";

export function isConversationSearchable(conversation: IConversation): boolean {
    return (
        conversation.semanticRefIndex !== undefined &&
        conversation.semanticRefs !== undefined
    );
}

export function textRangeForConversation(
    conversation: IConversation,
): TextRange {
    const messages = conversation.messages;
    return {
        start: { messageIndex: 0 },
        end: { messageIndex: messages.length - 1 },
    };
}

export type TimestampRange = {
    start: string;
    end?: string | undefined;
};

export function timestampRangeForConversation(
    conversation: IConversation,
): TimestampRange | undefined {
    const messages = conversation.messages;
    const start = messages[0].timestamp;
    const end = messages[messages.length - 1].timestamp;
    if (start !== undefined) {
        return {
            start,
            end,
        };
    }
    return undefined;
}

/**
 * Assumes messages are in timestamp order.
 * @param conversation
 */
export function getMessagesInDateRange(
    conversation: IConversation,
    dateRange: DateRange,
): IMessage[] {
    return collections.getInRange(
        conversation.messages,
        dateTime.timestampString(dateRange.start),
        dateRange.end ? dateTime.timestampString(dateRange.end) : undefined,
        (x, y) => x.localeCompare(y),
    );
}
/**
 * Returns:
 *  0 if locations are equal
 *  < 0 if x is less than y
 *  > 0 if x is greater than y
 * @param x
 * @param y
 * @returns
 */
export function compareTextLocation(x: TextLocation, y: TextLocation): number {
    let cmp = x.messageIndex - y.messageIndex;
    if (cmp !== 0) {
        return cmp;
    }
    cmp = (x.chunkIndex ?? 0) - (y.chunkIndex ?? 0);
    if (cmp !== 0) {
        return cmp;
    }
    return (x.charIndex ?? 0) - (y.charIndex ?? 0);
}

const MaxTextLocation: TextLocation = {
    messageIndex: Number.MAX_SAFE_INTEGER,
    chunkIndex: Number.MAX_SAFE_INTEGER,
    charIndex: Number.MAX_SAFE_INTEGER,
};

export function isInTextRange(
    outerRange: TextRange,
    innerRange: TextRange,
): boolean {
    // outer start must be <= inner start
    // inner end must be <= outerEnd
    let cmpStart = compareTextLocation(outerRange.start, innerRange.start);
    let cmpEnd = compareTextLocation(
        innerRange.end ?? MaxTextLocation,
        outerRange.end ?? MaxTextLocation,
    );
    return cmpStart <= 0 && cmpEnd <= 0;
}

export type DateRange = {
    start: Date;
    end?: Date | undefined;
};

export function compareDates(x: Date, y: Date): number {
    return x.getTime() - y.getTime();
}

export function isDateInRange(outerRange: DateRange, date: Date): boolean {
    // outer start must be <= date
    // date must be <= outer end
    let cmpStart = compareDates(outerRange.start, date);
    let cmpEnd =
        outerRange.end !== undefined ? compareDates(date, outerRange.end) : -1;
    return cmpStart <= 0 && cmpEnd <= 0;
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
        this.conversation.messages;
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
        public predicates: IQuerySemanticRefPredicate[],
    ) {}

    public async eval(
        context: QueryEvalContext,
    ): Promise<SemanticRefAccumulator> {
        const accumulator = await this.sourceExpr.eval(context);
        const filtered = new SemanticRefAccumulator(
            accumulator.queryTermMatches,
        );
        filtered.setMatches(
            accumulator.getMatches((match) =>
                this.evalPredicates(
                    context,
                    accumulator.queryTermMatches,
                    this.predicates,
                    match,
                ),
            ),
        );
        return filtered;
    }

    private evalPredicates(
        context: QueryEvalContext,
        queryTermMatches: QueryTermAccumulator,
        predicates: IQuerySemanticRefPredicate[],
        match: Match<SemanticRefIndex>,
    ) {
        for (let i = 0; i < predicates.length; ++i) {
            const semanticRef = context.getSemanticRef(match.value);
            if (predicates[i].eval(context, queryTermMatches, semanticRef)) {
                return true;
            }
        }
        return false;
    }
}

export interface IQuerySemanticRefPredicate {
    eval(
        context: QueryEvalContext,
        termMatches: QueryTermAccumulator,
        semanticRef: SemanticRef,
    ): boolean;
}

export class KnowledgeTypePredicate implements IQuerySemanticRefPredicate {
    constructor(public type: KnowledgeType) {}

    public eval(
        context: QueryEvalContext,
        termMatches: QueryTermAccumulator,
        semanticRef: SemanticRef,
    ): boolean {
        return semanticRef.knowledgeType === this.type;
    }
}

export class EntityPredicate implements IQuerySemanticRefPredicate {
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

export class ActionPredicate implements IQuerySemanticRefPredicate {
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

export class ScopeExpr implements IQueryOpExpr<SemanticRefAccumulator> {
    constructor(
        public sourceExpr: IQueryOpExpr<SemanticRefAccumulator>,
        public predicates: IQuerySemanticRefPredicate[],
    ) {}

    public async eval(
        context: QueryEvalContext,
    ): Promise<SemanticRefAccumulator> {
        let accumulator = await this.sourceExpr.eval(context);
        const tagScope = new TextRangeAccumulator();
        for (const inScopeRef of accumulator.getSemanticRefs(
            context.semanticRefs,
            (sr) =>
                this.evalPredicates(
                    context,
                    accumulator.queryTermMatches,
                    this.predicates,
                    sr,
                ),
        )) {
            tagScope.addRange(inScopeRef.range);
        }
        if (tagScope.size > 0) {
            accumulator = accumulator.selectInScope(
                context.semanticRefs,
                tagScope,
            );
        }
        return Promise.resolve(accumulator);
    }

    private evalPredicates(
        context: QueryEvalContext,
        queryTermMatches: QueryTermAccumulator,
        predicates: IQuerySemanticRefPredicate[],
        semanticRef: SemanticRef,
    ) {
        for (let i = 0; i < predicates.length; ++i) {
            if (predicates[i].eval(context, queryTermMatches, semanticRef)) {
                return true;
            }
        }
        return false;
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
