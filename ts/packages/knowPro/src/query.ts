// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DateRange,
    IConversation,
    IMessage,
    ITag,
    ITermToSemanticRefIndex,
    ITopic,
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
    TermMatchAccumulator,
    SemanticRefAccumulator,
    TextRangeAccumulator,
} from "./accumulators.js";
import { collections } from "typeagent";

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
    // inner end must be < outerEnd (which is exclusive)
    let cmpStart = compareTextLocation(outerRange.start, innerRange.start);
    let cmpEnd = compareTextLocation(
        innerRange.end ?? MaxTextLocation,
        outerRange.end ?? MaxTextLocation,
    );
    return cmpStart <= 0 && cmpEnd < 0;
}

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
    constructor(public conversation: IConversation) {
        if (!isConversationSearchable(conversation)) {
            throw new Error(`${conversation.nameTag} is not initialized`);
        }
    }

    public getSemanticRef(semanticRefIndex: SemanticRefIndex): SemanticRef {
        return this.conversation.semanticRefs![semanticRefIndex];
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
        const index = context.conversation.semanticRefIndex;
        if (index !== undefined) {
            const terms = await this.terms.eval(context);
            for (const queryTerm of terms) {
                this.accumulateMatches(index, matchAccumulator, queryTerm);
            }
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
        const index = context.conversation.relatedTermsIndex;
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
            context.conversation.semanticRefs!,
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
        queryTermMatches: TermMatchAccumulator,
        predicates: IQuerySemanticRefPredicate[],
        match: Match<SemanticRefIndex>,
    ) {
        for (let i = 0; i < predicates.length; ++i) {
            const semanticRef = context.getSemanticRef(match.value);
            if (!predicates[i].eval(context, queryTermMatches, semanticRef)) {
                return false;
            }
        }
        return true;
    }
}

export interface IQuerySemanticRefPredicate {
    eval(
        context: QueryEvalContext,
        termMatches: TermMatchAccumulator,
        semanticRef: SemanticRef,
    ): boolean;
}

export class KnowledgeTypePredicate implements IQuerySemanticRefPredicate {
    constructor(public type: KnowledgeType) {}

    public eval(
        context: QueryEvalContext,
        termMatches: TermMatchAccumulator,
        semanticRef: SemanticRef,
    ): boolean {
        return semanticRef.knowledgeType === this.type;
    }
}

export class PropertyMatchPredicate implements IQuerySemanticRefPredicate {
    constructor(
        public nameValues: Record<string, string>,
        public matchAll: boolean = true,
    ) {}

    public eval(
        context: QueryEvalContext,
        termMatches: TermMatchAccumulator,
        semanticRef: SemanticRef,
    ): boolean {
        for (const name of Object.keys(this.nameValues)) {
            const value = this.nameValues[name];
            if (
                !matchSemanticRefProperty(
                    termMatches,
                    semanticRef,
                    name,
                    value,
                ) &&
                this.matchAll
            ) {
                return false;
            }
        }
        return true;
    }
}

export function matchSemanticRefProperty(
    termMatches: TermMatchAccumulator,
    semanticRef: SemanticRef,
    propertyName: string,
    value: string,
) {
    switch (semanticRef.knowledgeType) {
        default:
            break;
        case "entity":
            return matchEntityProperty(
                termMatches,
                semanticRef.knowledge as knowLib.conversation.ConcreteEntity,
                propertyName,
                value,
            );
        case "action":
            return matchActionProperty(
                termMatches,
                semanticRef.knowledge as knowLib.conversation.Action,
                propertyName,
                value,
            );
        case "topic":
            return matchTopicProperty(
                termMatches,
                semanticRef.knowledge as ITopic,
                propertyName,
                value,
            );
        case "tag":
            return matchTagProperty(
                termMatches,
                semanticRef.knowledge as ITag,
                propertyName,
                value,
            );
    }
    return false;
}

export function matchEntityProperty(
    termMatches: TermMatchAccumulator,
    entity: knowLib.conversation.ConcreteEntity,
    propertyName: string,
    value: string,
) {
    if (propertyName === "name") {
        return matchText(termMatches, value, entity.name);
    } else if (propertyName === "type") {
        return matchTextOneOf(termMatches, value, entity.type);
    } else if (entity.facets !== undefined) {
        // try facets
        for (const facet of entity.facets) {
            if (
                matchText(termMatches, propertyName, facet.name) &&
                matchText(
                    termMatches,
                    value,
                    knowLib.conversation.knowledgeValueToString(facet.value),
                )
            ) {
                return true;
            }
        }
    }
    return false;
}

export type ActionPropertyName =
    | "verb"
    | "subject"
    | "object"
    | "indirectObject"
    | string;

export function matchActionProperty(
    termMatches: TermMatchAccumulator,
    action: knowLib.conversation.Action,
    propertyName: ActionPropertyName,
    value: string,
): boolean {
    switch (propertyName) {
        default:
            break;
        case "verb":
            return matchTextOneOf(termMatches, value, action.verbs);
        case "subject":
            return matchText(termMatches, value, action.subjectEntityName);
        case "object":
            return matchText(termMatches, value, action.objectEntityName);
        case "indirectObject":
            return matchText(
                termMatches,
                value,
                action.indirectObjectEntityName,
            );
    }
    return false;
}

export function matchTopicProperty(
    termMatches: TermMatchAccumulator,
    topic: ITopic,
    propertyName: string,
    value: string,
) {
    if (propertyName !== "topic") {
        return false;
    }
    return matchText(termMatches, value, topic.text);
}

export function matchTagProperty(
    termMatches: TermMatchAccumulator,
    tag: ITag,
    propertyName: string,
    value: string,
) {
    if (propertyName !== "tag") {
        return false;
    }
    return matchText(termMatches, value, tag.text);
}

function matchText(
    termMatches: TermMatchAccumulator,
    expected: string,
    actual: string | undefined,
): boolean {
    if (actual === undefined) {
        return false;
    }
    return (
        expected === "*" ||
        collections.stringEquals(expected, actual, false) ||
        termMatches.hasRelatedMatch(expected, actual)
    );
}

function matchTextOneOf(
    termMatches: TermMatchAccumulator,
    expected: string,
    actual: string[] | undefined,
) {
    if (actual !== undefined) {
        for (const text of actual) {
            if (matchText(termMatches, expected, text)) {
                return true;
            }
        }
    }
    return true;
}

export class ScopeExpr implements IQueryOpExpr<SemanticRefAccumulator> {
    constructor(
        public sourceExpr: IQueryOpExpr<SemanticRefAccumulator>,
        // Predicates that look at matched semantic refs to determine what is in scope
        public predicates: IQuerySemanticRefPredicate[],
        public scopeExpr: IQueryOpExpr<TextRange[]> | undefined = undefined,
    ) {}

    public async eval(
        context: QueryEvalContext,
    ): Promise<SemanticRefAccumulator> {
        let accumulator = await this.sourceExpr.eval(context);
        const scope = new TextRangeAccumulator();
        if (this.scopeExpr !== undefined) {
            const timeRanges = await this.scopeExpr.eval(context);
            if (timeRanges !== undefined) {
                scope.addRanges(timeRanges);
            }
        }
        for (const inScopeRef of accumulator.getSemanticRefs(
            context.conversation.semanticRefs!,
            (sr) =>
                this.evalPredicates(
                    context,
                    accumulator.queryTermMatches,
                    this.predicates!,
                    sr,
                ),
        )) {
            scope.addRange(inScopeRef.range);
        }
        if (scope.size > 0) {
            accumulator = accumulator.selectInScope(
                context.conversation.semanticRefs!,
                scope,
            );
        }
        return Promise.resolve(accumulator);
    }

    private evalPredicates(
        context: QueryEvalContext,
        queryTermMatches: TermMatchAccumulator,
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

export class TimestampScopeExpr implements IQueryOpExpr<TextRange[]> {
    constructor(public dateRange: DateRange) {}

    public eval(context: QueryEvalContext): Promise<TextRange[]> {
        const index = context.conversation.timestampIndex;
        let textRanges: TextRange[] | undefined;
        if (index !== undefined) {
            textRanges = index.getTextRange(this.dateRange);
        }
        return Promise.resolve(textRanges ?? []);
    }
}
