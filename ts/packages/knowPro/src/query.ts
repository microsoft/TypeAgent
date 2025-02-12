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
} from "./dataFormat.js";
import {
    KnowledgePropertyName,
    PropertySearchTerm,
    SearchTerm,
} from "./search.js";
import {
    Match,
    MatchAccumulator,
    PropertyTermSet,
    SemanticRefAccumulator,
    TermSet,
    TextRangeCollection,
} from "./collections.js";
import { PropertyNames } from "./propertyIndex.js";
import { conversation } from "knowledge-processor";
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

export const MaxTextLocation: TextLocation = {
    messageIndex: Number.MAX_SAFE_INTEGER,
    chunkIndex: Number.MAX_SAFE_INTEGER,
    charIndex: Number.MAX_SAFE_INTEGER,
};

export function compareTextRange(x: TextRange, y: TextRange) {
    let cmp = compareTextLocation(x.start, y.start);
    if (cmp !== 0) {
        return cmp;
    }
    if (x.end === undefined && y.end === undefined) {
        return cmp;
    }
    cmp = compareTextLocation(
        x.end ?? MaxTextLocation,
        y.end ?? MaxTextLocation,
    );
    return cmp;
}

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

export function isSearchTermWildcard(searchTerm: SearchTerm): boolean {
    return searchTerm.term.text === "*";
}

/**
 * A SearchTerm consists of (a) a term (b) optional terms related to term
 * Returns the term or related term that equals the given text
 * @param searchTerm
 * @param text
 * @returns The term or related term that matched the text
 */
export function getMatchingTermForText(
    searchTerm: SearchTerm,
    text: string,
): Term | undefined {
    // Do case-INSENSITIVE comparisons, since stored entities may have different case
    if (collections.stringEquals(text, searchTerm.term.text, false)) {
        return searchTerm.term;
    }
    if (searchTerm.relatedTerms && searchTerm.relatedTerms.length > 0) {
        for (const relatedTerm of searchTerm.relatedTerms) {
            if (collections.stringEquals(text, relatedTerm.text, false)) {
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
export function matchSearchTermToText(
    searchTerm: SearchTerm,
    text: string | undefined,
): boolean {
    if (text) {
        return getMatchingTermForText(searchTerm, text) !== undefined;
    }
    return false;
}

export function matchSearchTermToOneOfText(
    searchTerm: SearchTerm,
    texts: string[] | undefined,
): boolean {
    if (texts) {
        for (const text of texts) {
            if (matchSearchTermToText(searchTerm, text)) {
                return true;
            }
        }
    }
    return false;
}

export function matchPropertySearchTermToEntity(
    searchTerm: PropertySearchTerm,
    semanticRef: SemanticRef,
): boolean {
    if (semanticRef.knowledgeType !== "entity") {
        return false;
    }
    const entity = semanticRef.knowledge as conversation.ConcreteEntity;
    switch (searchTerm.propertyName) {
        default:
            break;
        case "type":
            return matchSearchTermToOneOfText(
                searchTerm.propertyValue,
                entity.type,
            );
        case "name":
            return matchSearchTermToText(searchTerm.propertyValue, entity.name);
    }
    return false;
}

export function matchPropertySearchTermToAction(
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
            return matchSearchTermToOneOfText(
                searchTerm.propertyValue,
                action.verbs,
            );
        case "subject":
            return entityNameMatch(
                searchTerm.propertyValue,
                action.subjectEntityName,
            );
        case "object":
            return entityNameMatch(
                searchTerm.propertyValue,
                action.objectEntityName,
            );
        case "indirectObject":
            return entityNameMatch(
                searchTerm.propertyValue,
                action.indirectObjectEntityName,
            );
    }
    return false;

    function entityNameMatch(searchTerm: SearchTerm, entityValue: string) {
        return (
            entityValue !== "none" &&
            matchSearchTermToText(searchTerm, entityValue)
        );
    }
}

export function matchPropertySearchTermToSemanticRef(
    searchTerm: PropertySearchTerm,
    semanticRef: SemanticRef,
): boolean {
    return (
        matchPropertySearchTermToEntity(searchTerm, semanticRef) ||
        matchPropertySearchTermToAction(searchTerm, semanticRef)
    );
}

export function lookupTermFiltered(
    semanticRefIndex: ITermToSemanticRefIndex,
    term: Term,
    semanticRefs: SemanticRef[],
    filter: (semanticRef: SemanticRef, scoredRef: ScoredSemanticRef) => boolean,
): ScoredSemanticRef[] | undefined {
    const scoredRefs = semanticRefIndex.lookupTerm(term.text);
    if (scoredRefs && scoredRefs.length > 0) {
        return scoredRefs.filter((sr) =>
            filter(semanticRefs[sr.semanticRefIndex], sr),
        );
    }
    return undefined;
}

export function lookupPropertySearchTerm(
    semanticRefIndex: ITermToSemanticRefIndex,
    propertySearchTerm: PropertySearchTerm,
    semanticRefs: SemanticRef[],
): ScoredSemanticRef[] | undefined {
    if (typeof propertySearchTerm.propertyName !== "string") {
        throw new Error("Not supported");
    }
    return lookupTermFiltered(
        semanticRefIndex,
        propertySearchTerm.propertyValue.term,
        semanticRefs,
        (semanticRef) =>
            matchPropertySearchTermToSemanticRef(
                propertySearchTerm,
                semanticRef,
            ),
    );
}

// Query eval expressions

export interface IQueryOpExpr<T> {
    eval(context: QueryEvalContext): T;
}

export class QueryEvalContext {
    private matchedTermText = new Set<string>();
    public matchedTerms = new TermSet();
    public matchedPropertyTerms = new PropertyTermSet();

    constructor(public conversation: IConversation) {
        if (!isConversationSearchable(conversation)) {
            throw new Error(
                `${conversation.nameTag} is not initialized and cannot be searched`,
            );
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

    public clearMatchedTerms() {
        this.matchedTermText.clear();
        this.matchedPropertyTerms.clear();
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

export class MatchAllTermsExpr extends QueryOpExpr<SemanticRefAccumulator> {
    constructor(public searchTermExpressions: MatchTermExpr[]) {
        super();
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        const allMatches = new SemanticRefAccumulator();
        context.clearMatchedTerms();
        context.matchedTerms.clear();
        for (const matchExpr of this.searchTermExpressions) {
            matchExpr.accumulateMatches(context, allMatches);
        }
        allMatches.calculateTotalScore();
        return allMatches;
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
            if (!context.matchedTerms.has(term)) {
                const semanticRefs = this.lookupTerm(context, term);
                matches.addTermMatches(term, semanticRefs, true);
                context.matchedTerms.add(term);
            }
        } else {
            if (!context.matchedTerms.has(relatedTerm)) {
                const semanticRefs = this.lookupTerm(context, relatedTerm);
                matches.addTermMatches(
                    term,
                    semanticRefs,
                    false,
                    relatedTerm.weight,
                );
                context.matchedTerms.add(relatedTerm);
            }
        }
    }
}

export class MatchTagExpr extends MatchSearchTermExpr {
    constructor(public tagTerm: SearchTerm) {
        super(tagTerm);
    }
    protected override lookupTerm(
        context: QueryEvalContext,
        term: Term,
    ): ScoredSemanticRef[] | undefined {
        return lookupTermFiltered(
            context.semanticRefIndex,
            term,
            context.semanticRefs,
            (semanticRef) => semanticRef.knowledgeType === "tag",
        );
    }
}

export class MatchPropertySearchTermExpr extends MatchTermExpr {
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
        propertyName: string,
        propertyValue: Term,
        relatedPropVal?: Term,
    ): void {
        const propertyIndex = context.propertyIndex;
        if (!propertyIndex) {
            return;
        }
        if (relatedPropVal === undefined) {
            if (
                !context.matchedPropertyTerms.has(propertyName, propertyValue)
            ) {
                const semanticRefs = this.lookupProperty(
                    context,
                    propertyName,
                    propertyValue.text,
                );
                matches.addTermMatches(propertyValue, semanticRefs, true);
                context.matchedPropertyTerms.add(propertyName, propertyValue);
            }
        } else {
            if (
                !context.matchedPropertyTerms.has(propertyName, relatedPropVal)
            ) {
                const semanticRefs = this.lookupProperty(
                    context,
                    propertyName,
                    relatedPropVal.text,
                );
                matches.addTermMatches(
                    propertyValue,
                    semanticRefs,
                    false,
                    relatedPropVal.weight,
                );
                context.matchedPropertyTerms.add(propertyName, relatedPropVal);
            }
        }
    }

    private lookupProperty(
        context: QueryEvalContext,
        propertyName: string,
        propertyValue: string,
        useIndex: boolean = true,
    ): ScoredSemanticRef[] | undefined {
        if (useIndex && context.propertyIndex) {
            return context.propertyIndex.lookupProperty(
                propertyName,
                propertyValue,
            );
        }
        return this.lookupPropertyWithoutIndex(
            context,
            propertyName,
            propertyValue,
        );
    }

    private lookupPropertyWithoutIndex(
        context: QueryEvalContext,
        propertyName: string,
        propertyValue: string,
    ): ScoredSemanticRef[] | undefined {
        return lookupPropertySearchTerm(
            context.semanticRefIndex,
            {
                propertyName: propertyName as KnowledgePropertyName,
                propertyValue: { term: { text: propertyValue } },
            },
            context.semanticRefs,
        );
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

function matchPredicates(
    context: QueryEvalContext,
    predicates: IQuerySemanticRefPredicate[],
    semanticRef: SemanticRef,
) {
    for (let i = 0; i < predicates.length; ++i) {
        if (!predicates[i].eval(context, semanticRef)) {
            return false;
        }
    }
    return true;
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
        return matchPropertySearchTermToSemanticRef(
            this.searchTerm,
            semanticRef,
        );
    }
}

export class SelectScopeExpr extends QueryOpExpr<SemanticRefAccumulator> {
    constructor(
        public sourceExpr: IQueryOpExpr<SemanticRefAccumulator>,
        public scopeExpr: IQuerySelectScopeExpr[],
    ) {
        super();
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        let accumulator = this.sourceExpr.eval(context);
        // Scope => text ranges in scope
        let textRangesInScope: TextRangeCollection | undefined;
        for (let i = 0; i < this.scopeExpr.length; ++i) {
            const rangesInScope = this.scopeExpr[i].eval(context, accumulator);
            if (rangesInScope) {
                textRangesInScope ??= new TextRangeCollection();
                textRangesInScope?.addRanges(rangesInScope);
            }
        }
        if (textRangesInScope !== undefined) {
            if (textRangesInScope.size > 0) {
                // Select only those semantic refs that are in scope
                accumulator = accumulator.getInScope(
                    context.semanticRefs,
                    textRangesInScope,
                );
            } else {
                accumulator.clearMatches();
            }
        }
        return accumulator;
    }
}

export interface IQuerySelectScopeExpr {
    eval(
        context: QueryEvalContext,
        semanticRefs: SemanticRefAccumulator,
    ): TextRangeCollection | undefined;
}

export class TimestampScopeExpr implements IQuerySelectScopeExpr {
    constructor(public dateRange: DateRange) {}

    public eval(
        context: QueryEvalContext,
        semanticRefs: SemanticRefAccumulator,
    ): TextRangeCollection | undefined {
        const index = context.conversation.timestampIndex;
        if (index) {
            const timeRanges = index.lookupRange(this.dateRange);
            const textRangesInScope = new TextRangeCollection();
            for (const timeRange of timeRanges) {
                textRangesInScope.addRange(timeRange.range);
            }
            return textRangesInScope;
        }
        return undefined;
    }
}

export class PredicateScopeExpr implements IQuerySelectScopeExpr {
    constructor(public predicates: IQuerySemanticRefPredicate[]) {}

    public eval(
        context: QueryEvalContext,
        accumulator: SemanticRefAccumulator,
    ): TextRangeCollection | undefined {
        if (this.predicates && this.predicates.length > 0) {
            const textRangesInScope = new TextRangeCollection();
            for (const inScopeRef of accumulator.getSemanticRefs(
                context.semanticRefs,
                (sr) => matchPredicates(context, this.predicates, sr),
            )) {
                textRangesInScope.addRange(inScopeRef.range);
            }
            return textRangesInScope;
        }
        return undefined;
    }
}

export class TagScopeExpr implements IQuerySelectScopeExpr {
    constructor() {}

    public eval(
        context: QueryEvalContext,
        accumulator: SemanticRefAccumulator,
    ): TextRangeCollection | undefined {
        let textRangesInScope: TextRangeCollection | undefined;
        for (const inScopeRef of accumulator.getSemanticRefs(
            context.semanticRefs,
            (sr) => sr.knowledgeType === "tag",
        )) {
            textRangesInScope ??= new TextRangeCollection();
            textRangesInScope.addRange(inScopeRef.range);
        }
        return textRangesInScope;
    }
}
