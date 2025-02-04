// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DateRange,
    IConversation,
    IMessage,
    IPropertyToSemanticRefIndex,
    ITermToSemanticRefIndex,
    KnowledgeType,
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
    QualifiedSearchTerm,
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

export function textRangeForMessage(
    message: IMessage,
    messageIndex: number,
): TextRange {
    let start: TextLocation = {
        messageIndex,
        chunkIndex: 0,
        charIndex: 0,
    };
    // End is EXCLUSIVE. Since entire message is range, the end is messageIndex + 1
    let end: TextLocation = {
        messageIndex: messageIndex + 1,
    };
    return {
        start,
        end,
    };
}

export function lookupSearchTermInIndex(
    semanticRefIndex: ITermToSemanticRefIndex,
    searchTerm: SearchTerm,
    matchAccumulator?: SemanticRefAccumulator,
): SemanticRefAccumulator {
    matchAccumulator ??= new SemanticRefAccumulator();
    // Lookup search term
    matchAccumulator.addSearchTermMatch(
        searchTerm.term,
        semanticRefIndex.lookupTerm(searchTerm.term.text),
    );
    // And any related terms
    if (searchTerm.relatedTerms && searchTerm.relatedTerms.length > 0) {
        for (const relatedTerm of searchTerm.relatedTerms) {
            // Related term matches count as matches for the queryTerm...
            // BUT are scored with the score of the related term
            matchAccumulator.addRelatedTermMatch(
                searchTerm.term,
                relatedTerm,
                semanticRefIndex.lookupTerm(relatedTerm.text),
                relatedTerm.score,
            );
        }
    }
    return matchAccumulator;
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
export function searchTermEqualsText(
    searchTerm: SearchTerm,
    text: string | undefined,
): boolean {
    if (text) {
        return getMatchingTermForText(searchTerm, text) !== undefined;
    }
    return false;
}

export function searchTermEqualsOneOfText(
    searchTerm: SearchTerm,
    texts: string[] | undefined,
): boolean {
    if (texts) {
        for (const text of texts) {
            if (searchTermEqualsText(searchTerm, text)) {
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

export type QueryTermExpr = MatchSearchTermExpr | MatchQualifiedSearchTermExpr;

export class MatchTermsExpr extends QueryOpExpr<SemanticRefAccumulator> {
    constructor(public searchTermExpressions: QueryTermExpr[]) {
        super();
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        const matchAccumulator: SemanticRefAccumulator =
            new SemanticRefAccumulator();
        const index = context.conversation.semanticRefIndex;
        if (index !== undefined) {
            for (const matchExpr of this.searchTermExpressions) {
                const matches = matchExpr.eval(context);
                if (matches && matches.size > 0) {
                    matchAccumulator.addUnion(matches);
                }
            }
        }
        return matchAccumulator;
    }
}

export class MatchSearchTermExpr extends QueryOpExpr<SemanticRefAccumulator> {
    constructor(public searchTerm: SearchTerm) {
        super();
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        const matchAccumulator = new SemanticRefAccumulator();
        const semanticRefIndex = context.conversation.semanticRefIndex;
        if (semanticRefIndex) {
            lookupSearchTermInIndex(
                semanticRefIndex,
                this.searchTerm,
                matchAccumulator,
            );
        }
        return matchAccumulator;
    }
}

export class MatchQualifiedSearchTermExpr extends QueryOpExpr<
    SemanticRefAccumulator | undefined
> {
    constructor(public searchTerm: QualifiedSearchTerm) {
        super();
    }

    public override eval(
        context: QueryEvalContext,
    ): SemanticRefAccumulator | undefined {
        if (!context.conversation.propertyToSemanticRefIndex) {
            return undefined;
        }
        let matches: SemanticRefAccumulator | undefined;
        if (this.searchTerm.type === "property") {
            matches = this.matchProperty(context, this.searchTerm);
        } else {
            matches = this.matchFacet(context, this.searchTerm);
        }
        return matches;
    }

    private matchProperty(
        context: QueryEvalContext,
        searchTerm: PropertySearchTerm,
    ): SemanticRefAccumulator | undefined {
        const propertyIndex = context.conversation.propertyToSemanticRefIndex!;
        return lookupSearchTermInPropertyIndex(
            propertyIndex,
            searchTerm.propertyName,
            searchTerm.propertyValue,
        );
    }

    private matchFacet(
        context: QueryEvalContext,
        facetSearchTerm: FacetSearchTerm,
    ): SemanticRefAccumulator | undefined {
        const propertyIndex = context.conversation.propertyToSemanticRefIndex!;
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
                facetMatches = facetMatches.intersect(valueMatches);
            }
        }

        return facetMatches;
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
        return semanticRefMatches.groupMatchesByType(
            context.conversation.semanticRefs!,
        );
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
        return false;
    }
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
            context.conversation.semanticRefs!,
            (sr) => this.evalPredicates(context, this.predicates!, sr),
        )) {
            scope.addRange(inScopeRef.range);
        }
        if (scope.size > 0) {
            // Select only those semantic refs that are in scope
            accumulator = accumulator.getInScope(
                context.conversation.semanticRefs!,
                scope,
            );
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
