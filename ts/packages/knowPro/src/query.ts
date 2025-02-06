// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DateRange,
    IConversation,
    IMessage,
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
import { PropertySearchTerm, SearchTerm } from "./search.js";
import {
    Match,
    MatchAccumulator,
    SemanticRefAccumulator,
    TextRangeCollection,
} from "./collections.js";
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

export function* lookupTermFiltered(
    semanticRefIndex: ITermToSemanticRefIndex,
    term: Term,
    semanticRefs: SemanticRef[],
    filter: (
        semanticRefs: SemanticRef[],
        scoredRef: ScoredSemanticRef,
    ) => boolean,
) {
    const scoredRefs = semanticRefIndex.lookupTerm(term.text);
    if (scoredRefs && scoredRefs.length > 0) {
        for (const scoredRef of scoredRefs) {
            if (filter(semanticRefs, scoredRef)) {
                yield scoredRef;
            }
        }
    }
}

export function* lookupTermFilterByType(
    semanticRefIndex: ITermToSemanticRefIndex,
    term: Term,
    semanticRefs: SemanticRef[],
    knowledgeType: KnowledgeType,
) {
    const scoredRefs = semanticRefIndex.lookupTerm(term.text);
    if (scoredRefs && scoredRefs.length > 0) {
        for (const scoredRef of scoredRefs) {
            if (
                semanticRefs[scoredRef.semanticRefIndex].knowledgeType ===
                knowledgeType
            ) {
                yield scoredRef;
            }
        }
    }
}

export function isSearchTermWildcard(searchTerm: SearchTerm): boolean {
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
    private matchedTermText = new Set<string>();
    constructor(public conversation: IConversation) {
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

    public hasTermAlreadyMatched(termText: string): boolean {
        return this.matchedTermText.has(termText);
    }

    public recordTermMatch(termText: string): void {
        this.matchedTermText.add(termText);
    }

    public hasPropertyAlreadyMatched(
        propertyName: string,
        propertyValue: string,
    ): boolean {
        return this.matchedTermText.has(propertyName + propertyValue);
    }

    public recordPropertyMatched(
        propertyName: string,
        propertyValue: string,
    ): void {
        this.matchedTermText.add(propertyName + propertyValue);
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

export class GetSearchMatchesExpr extends QueryOpExpr<SemanticRefAccumulator> {
    constructor(public searchTermExpressions: MatchTermExpr[]) {
        super();
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        const matches = new SemanticRefAccumulator();
        for (const matchExpr of this.searchTermExpressions) {
            matchExpr.accumulateMatches(context, matches);
        }
        return matches;
    }
}

export class MatchTermExpr extends QueryOpExpr<
    SemanticRefAccumulator | undefined
> {
    constructor() {
        super();
    }

    public override eval(
        context: QueryEvalContext,
    ): SemanticRefAccumulator | undefined {
        const matches = new SemanticRefAccumulator();
        this.accumulateMatches(context, matches);
        return matches.size > 0 ? matches : undefined;
    }

    public accumulateMatches(
        context: QueryEvalContext,
        matches: SemanticRefAccumulator,
    ) {
        return;
    }
}

export class MatchSearchTermExpr extends MatchTermExpr {
    constructor(public searchTerm: SearchTerm) {
        super();
    }

    public override accumulateMatches(
        context: QueryEvalContext,
        matches: SemanticRefAccumulator,
    ) {
        // Match the search term
        this.accumulateMatchesForTerm(context, matches, this.searchTerm.term);
        // And any related terms
        if (
            this.searchTerm.relatedTerms &&
            this.searchTerm.relatedTerms.length > 0
        ) {
            for (const relatedTerm of this.searchTerm.relatedTerms) {
                this.accumulateMatchesForTerm(
                    context,
                    matches,
                    this.searchTerm.term,
                    relatedTerm,
                );
            }
        }
    }

    protected lookupTerm(
        context: QueryEvalContext,
        term: Term,
    ): ScoredSemanticRef[] | IterableIterator<ScoredSemanticRef> | undefined {
        return context.semanticRefIndex.lookupTerm(term.text);
    }

    private accumulateMatchesForTerm(
        context: QueryEvalContext,
        matches: SemanticRefAccumulator,
        term: Term,
        relatedTerm?: Term,
    ) {
        if (relatedTerm === undefined) {
            const semanticRefs = this.lookupTerm(context, term);
            if (context.hasTermAlreadyMatched(term.text)) {
                matches.updateExistingMatchScores(term, semanticRefs, true);
            } else {
                matches.addSearchTermMatches(term, semanticRefs);
                context.recordTermMatch(term.text);
            }
        } else {
            const semanticRefs = this.lookupTerm(context, relatedTerm);
            if (context.hasTermAlreadyMatched(relatedTerm.text)) {
                matches.updateExistingMatchScores(
                    term,
                    semanticRefs,
                    false,
                    relatedTerm.score,
                );
            } else {
                matches.addRelatedTermMatches(term, relatedTerm, semanticRefs);
                context.recordTermMatch(relatedTerm.text);
            }
        }
    }
}

export class MatchTagExpr extends MatchSearchTermExpr {
    constructor(public tagTerm: SearchTerm) {
        super(tagTerm);
    }
    protected override lookupTerm(context: QueryEvalContext, term: Term) {
        return lookupTermFilterByType(
            context.semanticRefIndex,
            term,
            context.semanticRefs,
            "tag",
        );
    }
}

export class MatchPropertyTermExpr extends MatchTermExpr {
    constructor(public propertySearchTerm: PropertySearchTerm) {
        super();
    }

    public override accumulateMatches(
        context: QueryEvalContext,
        matches: SemanticRefAccumulator,
    ): void {
        if (typeof this.propertySearchTerm.propertyName === "string") {
            this.accumulateMatchesForProperty(
                context,
                this.propertySearchTerm.propertyName,
                this.propertySearchTerm.propertyValue,
                matches,
            );
        } else {
            this.accumulateMatchesForFacets(
                context,
                this.propertySearchTerm.propertyName,
                this.propertySearchTerm.propertyValue,
                matches,
            );
        }
    }

    private accumulateMatchesForFacets(
        context: QueryEvalContext,
        propertyName: SearchTerm,
        propertyValue: SearchTerm,
        matches: SemanticRefAccumulator,
    ) {
        this.accumulateMatchesForProperty(
            context,
            PropertyNames.FacetName,
            propertyName,
            matches,
        );
        if (!isSearchTermWildcard(propertyValue)) {
            this.accumulateMatchesForProperty(
                context,
                PropertyNames.FacetValue,
                propertyValue,
                matches,
            );
        }
    }

    private accumulateMatchesForProperty(
        context: QueryEvalContext,
        propertyName: string,
        propertyValue: SearchTerm,
        matches: SemanticRefAccumulator,
    ) {
        this.accumulateMatchesForPropertyValue(
            context,
            matches,
            propertyName,
            propertyValue.term,
        );
        if (
            propertyValue.relatedTerms &&
            propertyValue.relatedTerms.length > 0
        ) {
            for (const relatedPropertyValue of propertyValue.relatedTerms) {
                this.accumulateMatchesForPropertyValue(
                    context,
                    matches,
                    propertyName,
                    propertyValue.term,
                    relatedPropertyValue,
                );
            }
        }
    }

    private accumulateMatchesForPropertyValue(
        context: QueryEvalContext,
        matches: SemanticRefAccumulator,
        propName: string,
        propVal: Term,
        relatedPropVal?: Term,
    ): void {
        const propertyIndex = context.propertyIndex;
        if (!propertyIndex) {
            return;
        }
        if (relatedPropVal === undefined) {
            const semanticRefs = propertyIndex.lookupProperty(
                propName,
                propVal.text,
            );
            if (context.hasPropertyAlreadyMatched(propName, propVal.text)) {
                matches.updateExistingMatchScores(propVal, semanticRefs, true);
            } else {
                matches.addSearchTermMatches(propVal, semanticRefs);
                context.recordPropertyMatched(propName, propVal.text);
            }
        } else {
            const semanticRefs = propertyIndex.lookupProperty(
                propName,
                relatedPropVal.text,
            );
            if (
                context.hasPropertyAlreadyMatched(propName, relatedPropVal.text)
            ) {
                matches.updateExistingMatchScores(
                    propVal,
                    semanticRefs,
                    false,
                    relatedPropVal.score,
                );
            } else {
                matches.addRelatedTermMatches(
                    propVal,
                    relatedPropVal,
                    semanticRefs,
                );
                context.recordPropertyMatched(propName, relatedPropVal.text);
            }
        }
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
