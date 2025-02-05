// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DateRange,
    IConversation,
    IMessage,
    IPropertyToSemanticRefIndex,
    ITermToSemanticRefIndex,
    KnowledgeType,
    ScoredSemanticRef,
    SemanticRef,
    SemanticRefIndex,
    Term,
    TextLocation,
    TextRange,
    TimestampedTextRange,
} from "./dataFormat.js";
import {
    PropertySearchTerm,
    FacetSearchTerm,
    ConstrainedSearchTerm,
    SearchTerm,
} from "./search.js";
import {
    Match,
    MatchAccumulator,
    SemanticRefAccumulator,
    TextRangeCollection,
} from "./collections.js";
import { TermToRelatedTermsMap } from "./relatedTermsIndex.js";
import { PropertyNames } from "./propertyIndex.js";
import { conversation } from "knowledge-processor";

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

export const MaxTextLocation: TextLocation = {
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
    if (outerRange.end === undefined && innerRange.end === undefined) {
        return cmpStart <= 0;
    }
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

export function messageLength(message: IMessage): number {
    let length = 0;
    for (const chunk of message.textChunks) {
        length += chunk.length;
    }
    return length;
}

/**
 * Look
 * @param semanticRefIndex
 * @param searchTerm
 * @param predicate
 * @param matches
 * @returns
 */
export function lookupSearchTermInIndex(
    semanticRefIndex: ITermToSemanticRefIndex,
    searchTerm: SearchTerm,
    predicate?: (scoredRef: ScoredSemanticRef) => boolean,
    matches?: SemanticRefAccumulator,
): SemanticRefAccumulator {
    matches ??= new SemanticRefAccumulator();
    // Lookup search term
    matches.addSearchTermMatch(
        searchTerm.term,
        predicate
            ? lookupAndFilter(semanticRefIndex, searchTerm.term.text, predicate)
            : semanticRefIndex.lookupTerm(searchTerm.term.text),
    );
    // And any related terms
    if (searchTerm.relatedTerms && searchTerm.relatedTerms.length > 0) {
        for (const relatedTerm of searchTerm.relatedTerms) {
            // Related term matches count as matches for the queryTerm...
            // BUT are scored with the score of the related term
            matches.addRelatedTermMatch(
                searchTerm.term,
                relatedTerm,
                predicate
                    ? lookupAndFilter(
                          semanticRefIndex,
                          relatedTerm.text,
                          predicate,
                      )
                    : semanticRefIndex.lookupTerm(relatedTerm.text),
                relatedTerm.score,
            );
        }
    }
    return matches;

    function* lookupAndFilter(
        semanticRefIndex: ITermToSemanticRefIndex,
        text: string,
        predicate: (scoredRef: ScoredSemanticRef) => boolean,
    ) {
        const scoredRefs = semanticRefIndex.lookupTerm(text);
        if (scoredRefs) {
            for (const scoredRef of scoredRefs) {
                if (predicate(scoredRef)) {
                    yield scoredRef;
                }
            }
        }
    }
}

export function lookupSearchTermInPropertyIndex(
    propertyIndex: IPropertyToSemanticRefIndex,
    propertyName: string,
    searchTerm: SearchTerm,
    matchAccumulator?: SemanticRefAccumulator,
): SemanticRefAccumulator {
    matchAccumulator ??= new SemanticRefAccumulator();
    // Lookup search term
    matchAccumulator.addSearchTermMatch(
        searchTerm.term,
        propertyIndex.lookupProperty(propertyName, searchTerm.term.text),
    );
    // And any related terms
    if (searchTerm.relatedTerms && searchTerm.relatedTerms.length > 0) {
        for (const relatedTerm of searchTerm.relatedTerms) {
            // Related term matches count as matches for the queryTerm...
            // BUT are scored with the score of the related term
            matchAccumulator.addRelatedTermMatch(
                searchTerm.term,
                relatedTerm,
                propertyIndex.lookupProperty(propertyName, relatedTerm.text),
                relatedTerm.score,
            );
        }
    }
    return matchAccumulator;
}

function isSearchTermWildcard(searchTerm: SearchTerm): boolean {
    return searchTerm.term.text === "*";
}

/**
 * A SearchTerm consists of (a) a term (b) optional terms related to term
 * Returns the term or related term that equals the given text
 * @param searchTerm
 * @param text
 * @returns
 */
export function getMatchingTermForText(
    searchTerm: SearchTerm,
    text: string,
): Term | undefined {
    if (text === searchTerm.term.text) {
        return searchTerm.term;
    }
    if (searchTerm.relatedTerms && searchTerm.relatedTerms.length > 0) {
        for (const relatedTerm of searchTerm.relatedTerms) {
            if (text === relatedTerm.text) {
                return relatedTerm;
            }
        }
    }
    return undefined;
}

/**
 * See if a search term equals the given text.
 * Also compares any related terms
 * @param searchTerm
 * @param text
 */
export function searchTermMatchesText(
    searchTerm: SearchTerm,
    text: string | undefined,
): boolean {
    if (text) {
        return getMatchingTermForText(searchTerm, text) !== undefined;
    }
    return false;
}

export function searchTermMatchesOneOfText(
    searchTerm: SearchTerm,
    texts: string[] | undefined,
): boolean {
    if (texts) {
        for (const text of texts) {
            if (searchTermMatchesText(searchTerm, text)) {
                return true;
            }
        }
    }
    return false;
}

// Query eval expressions

export interface IQueryOpExpr<T> {
    eval(context: QueryEvalContext): T;
}

export class QueryEvalContext {
    constructor(
        public conversation: IConversation,
        public termToRelatedTerms: TermToRelatedTermsMap = new TermToRelatedTermsMap(),
    ) {
        if (!isConversationSearchable(conversation)) {
            throw new Error(`${conversation.nameTag} is not initialized`);
        }
    }

    public get semanticRefIndex() {
        return this.conversation.semanticRefIndex!;
    }

    public get semanticRefs() {
        return this.conversation.semanticRefs!;
    }

    public get propertyIndex() {
        return this.conversation.propertyToSemanticRefIndex;
    }

    public getSemanticRef(semanticRefIndex: SemanticRefIndex): SemanticRef {
        return this.conversation.semanticRefs![semanticRefIndex];
    }

    public getMessageForRef(semanticRef: SemanticRef): IMessage {
        const messageIndex = semanticRef.range.start.messageIndex;
        return this.conversation.messages[messageIndex];
    }
}

export class QueryOpExpr<T = void> implements IQueryOpExpr<T> {
    public eval(context: QueryEvalContext): T {
        throw new Error("Not implemented");
    }
}

export class SelectTopNExpr<T extends MatchAccumulator> extends QueryOpExpr<T> {
    constructor(
        public sourceExpr: IQueryOpExpr<T>,
        public maxMatches: number | undefined = undefined,
        public minHitCount: number | undefined = undefined,
    ) {
        super();
    }

    public override eval(context: QueryEvalContext): T {
        const matches = this.sourceExpr.eval(context);
        matches.selectTopNScoring(this.maxMatches, this.minHitCount);
        return matches;
    }
}

export type QueryTermExpr =
    | MatchSearchTermExpr
    | MatchConstrainedSearchTermExpr;

export class GetSearchMatchesExpr extends QueryOpExpr<SemanticRefAccumulator> {
    constructor(public searchTermExpressions: QueryTermExpr[]) {
        super();
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        const allMatches: SemanticRefAccumulator = new SemanticRefAccumulator();

        for (const matchExpr of this.searchTermExpressions) {
            const termMatches = matchExpr.eval(context);
            if (termMatches && termMatches.size > 0) {
                allMatches.addUnion(termMatches);
            }
        }
        return allMatches;
    }
}

export class MatchSearchTermExpr extends QueryOpExpr<SemanticRefAccumulator> {
    constructor(public searchTerm: SearchTerm) {
        super();
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        return lookupSearchTermInIndex(
            context.semanticRefIndex,
            this.searchTerm,
        );
    }
}

export class MatchConstrainedSearchTermExpr extends QueryOpExpr<
    SemanticRefAccumulator | undefined
> {
    constructor(public qualifiedSearchTerm: ConstrainedSearchTerm) {
        super();
    }

    public override eval(
        context: QueryEvalContext,
    ): SemanticRefAccumulator | undefined {
        if (!context.propertyIndex) {
            return undefined;
        }
        let matches: SemanticRefAccumulator | undefined;
        if (this.qualifiedSearchTerm.type === "property") {
            matches = this.matchProperty(context, this.qualifiedSearchTerm);
        } else {
            matches = this.matchFacet(context, this.qualifiedSearchTerm);
        }
        return matches;
    }

    private matchProperty(
        context: QueryEvalContext,
        propertySearchTerm: PropertySearchTerm,
    ): SemanticRefAccumulator | undefined {
        if (propertySearchTerm.propertyName === "tag") {
            return this.matchTag(context, propertySearchTerm);
        }
        const propertyIndex = context.propertyIndex;
        if (propertyIndex) {
            return lookupSearchTermInPropertyIndex(
                propertyIndex,
                propertySearchTerm.propertyName,
                propertySearchTerm.propertyValue,
            );
        }
        return undefined;
    }

    private matchTag(
        context: QueryEvalContext,
        searchTerm: PropertySearchTerm,
    ) {
        return lookupSearchTermInIndex(
            context.semanticRefIndex,
            searchTerm.propertyValue,
            (scoredRef) => {
                return (
                    context.getSemanticRef(scoredRef.semanticRefIndex)
                        .knowledgeType === "tag"
                );
            },
        );
    }

    private matchFacet(
        context: QueryEvalContext,
        facetSearchTerm: FacetSearchTerm,
    ): SemanticRefAccumulator | undefined {
        const propertyIndex = context.propertyIndex;
        if (propertyIndex) {
            let facetMatches = lookupSearchTermInPropertyIndex(
                propertyIndex,
                PropertyNames.FacetName,
                facetSearchTerm.facetName,
            );
            if (
                facetMatches.size > 0 &&
                facetSearchTerm.facetValue &&
                !isSearchTermWildcard(facetSearchTerm.facetValue)
            ) {
                let valueMatches = lookupSearchTermInPropertyIndex(
                    propertyIndex,
                    PropertyNames.FacetValue,
                    facetSearchTerm.facetValue,
                );
                if (valueMatches.size > 0) {
                    facetMatches.addUnion(valueMatches);
                }
            }

            return facetMatches;
        }
        return undefined;
    }
}

export class GroupByKnowledgeTypeExpr extends QueryOpExpr<
    Map<KnowledgeType, SemanticRefAccumulator>
> {
    constructor(public matches: IQueryOpExpr<SemanticRefAccumulator>) {
        super();
    }

    public override eval(
        context: QueryEvalContext,
    ): Map<KnowledgeType, SemanticRefAccumulator> {
        const semanticRefMatches = this.matches.eval(context);
        return semanticRefMatches.groupMatchesByType(context.semanticRefs);
    }
}

export class SelectTopNKnowledgeGroupExpr extends QueryOpExpr<
    Map<KnowledgeType, SemanticRefAccumulator>
> {
    constructor(
        public sourceExpr: IQueryOpExpr<
            Map<KnowledgeType, SemanticRefAccumulator>
        >,
        public maxMatches: number | undefined = undefined,
        public minHitCount: number | undefined = undefined,
    ) {
        super();
    }

    public override eval(
        context: QueryEvalContext,
    ): Map<KnowledgeType, SemanticRefAccumulator> {
        const groupsAccumulators = this.sourceExpr.eval(context);
        for (const accumulator of groupsAccumulators.values()) {
            accumulator.selectTopNScoring(this.maxMatches, this.minHitCount);
        }
        return groupsAccumulators;
    }
}

export class WhereSemanticRefExpr extends QueryOpExpr<SemanticRefAccumulator> {
    constructor(
        public sourceExpr: IQueryOpExpr<SemanticRefAccumulator>,
        public predicates: IQuerySemanticRefPredicate[],
    ) {
        super();
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        const accumulator = this.sourceExpr.eval(context);
        const filtered = new SemanticRefAccumulator(
            accumulator.searchTermMatches,
        );
        filtered.setMatches(
            accumulator.getMatches((match) =>
                this.evalPredicates(context, this.predicates, match),
            ),
        );
        return filtered;
    }

    private evalPredicates(
        context: QueryEvalContext,
        predicates: IQuerySemanticRefPredicate[],
        match: Match<SemanticRefIndex>,
    ) {
        for (let i = 0; i < predicates.length; ++i) {
            const semanticRef = context.getSemanticRef(match.value);
            if (!predicates[i].eval(context, semanticRef)) {
                return false;
            }
        }
        return true;
    }
}

export interface IQuerySemanticRefPredicate {
    eval(context: QueryEvalContext, semanticRef: SemanticRef): boolean;
}

export class KnowledgeTypePredicate implements IQuerySemanticRefPredicate {
    constructor(public type: KnowledgeType) {}

    public eval(context: QueryEvalContext, semanticRef: SemanticRef): boolean {
        return semanticRef.knowledgeType === this.type;
    }
}

export class PropertyMatchPredicate implements IQuerySemanticRefPredicate {
    constructor(public searchTerm: PropertySearchTerm) {}

    public eval(context: QueryEvalContext, semanticRef: SemanticRef): boolean {
        return (
            searchTermMatchesEntity(this.searchTerm, semanticRef) ||
            searchTermMatchesAction(this.searchTerm, semanticRef)
        );
    }
}

export function searchTermMatchesEntity(
    searchTerm: PropertySearchTerm,
    semanticRef: SemanticRef,
) {
    if (semanticRef.knowledgeType !== "entity") {
        return false;
    }
    const entity = semanticRef.knowledge as conversation.ConcreteEntity;
    switch (searchTerm.propertyName) {
        default:
            break;
        case "type":
            return searchTermMatchesOneOfText(
                searchTerm.propertyValue,
                entity.type,
            );
        case "name":
            return searchTermMatchesText(searchTerm.propertyValue, entity.name);
    }
    return false;
}

export function searchTermMatchesAction(
    searchTerm: PropertySearchTerm,
    semanticRef: SemanticRef,
): boolean {
    if (semanticRef.knowledgeType !== "action") {
        return false;
    }
    const action = semanticRef.knowledge as conversation.Action;
    switch (searchTerm.propertyName) {
        default:
            break;
        case "verb":
            return searchTermMatchesOneOfText(
                searchTerm.propertyValue,
                action.verbs,
            );
        case "subject":
            return searchTermMatchesText(
                searchTerm.propertyValue,
                action.subjectEntityName,
            );
        case "object":
            return searchTermMatchesText(
                searchTerm.propertyValue,
                action.objectEntityName,
            );
        case "indirectObject":
            return searchTermMatchesText(
                searchTerm.propertyValue,
                action.indirectObjectEntityName,
            );
    }
    return false;
}

export class ScopeExpr extends QueryOpExpr<SemanticRefAccumulator> {
    constructor(
        public sourceExpr: IQueryOpExpr<SemanticRefAccumulator>,
        // Predicates that look at matched semantic refs to determine what is in scope
        public predicates: IQuerySemanticRefPredicate[],
        public timeScopeExpr:
            | IQueryOpExpr<TimestampedTextRange[]>
            | undefined = undefined,
    ) {
        super();
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        let accumulator = this.sourceExpr.eval(context);
        // Scope => text ranges in scope
        const scope = new TextRangeCollection();

        // If we are scoping the conversation by time range, then collect
        // text ranges in the given time range
        if (this.timeScopeExpr) {
            const timeRanges = this.timeScopeExpr.eval(context);
            if (timeRanges) {
                for (const timeRange of timeRanges) {
                    scope.addRange(timeRange.range);
                }
            }
        }

        // Inspect all accumulated semantic refs using predicates.
        // E.g. only look at ranges matching actions where X is a subject and Y an object
        // The text ranges for matching refs give us the text ranges in scope
        for (const inScopeRef of accumulator.getSemanticRefs(
            context.semanticRefs,
            (sr) => this.evalPredicates(context, this.predicates!, sr),
        )) {
            scope.addRange(inScopeRef.range);
        }
        if (scope.size > 0) {
            // Select only those semantic refs that are in scope
            accumulator = accumulator.getInScope(context.semanticRefs, scope);
        }
        return accumulator;
    }

    private evalPredicates(
        context: QueryEvalContext,
        predicates: IQuerySemanticRefPredicate[],
        semanticRef: SemanticRef,
    ) {
        for (let i = 0; i < predicates.length; ++i) {
            if (predicates[i].eval(context, semanticRef)) {
                return true;
            }
        }
        return false;
    }
}

export class TimestampScopeExpr extends QueryOpExpr<TimestampedTextRange[]> {
    constructor(public dateRange: DateRange) {
        super();
    }

    public override eval(context: QueryEvalContext): TimestampedTextRange[] {
        const index = context.conversation.timestampIndex;
        let ranges: TimestampedTextRange[] | undefined;
        if (index !== undefined) {
            ranges = index.lookupRange(this.dateRange);
        }
        return ranges ?? [];
    }
}
