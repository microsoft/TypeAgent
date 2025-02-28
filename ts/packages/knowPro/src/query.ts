// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DateRange,
    IConversation,
    IMessage,
    ITermToSemanticRefIndex,
    KnowledgeType,
    MessageIndex,
    ScoredSemanticRef,
    SemanticRef,
    SemanticRefIndex,
    Tag,
    Term,
    TextRange,
} from "./interfaces.js";
import {
    KnowledgePropertyName,
    PropertySearchTerm,
    SearchResult,
    SearchTerm,
} from "./search.js";
import {
    Match,
    MatchAccumulator,
    PropertyTermSet,
    SemanticRefAccumulator,
    TermSet,
    TextRangeCollection,
    TextRangesInScope,
} from "./collections.js";
import {
    lookupPropertyInPropertyIndex,
    PropertyNames,
} from "./propertyIndex.js";
import { ITimestampToTextRangeIndex } from "./interfaces.js";
import { IPropertyToSemanticRefIndex } from "./interfaces.js";
import { conversation as kpLib } from "knowledge-processor";
import { collections } from "typeagent";
import { Thread } from "./interfaces.js";
import { facetValueToString } from "./knowledge.js";
import { isInDateRange, isSearchTermWildcard } from "./common.js";

export function isConversationSearchable(conversation: IConversation): boolean {
    return (
        conversation.semanticRefIndex !== undefined &&
        conversation.semanticRefs !== undefined
    );
}

export function getTextRangeForDateRange(
    conversation: IConversation,
    dateRange: DateRange,
): TextRange | undefined {
    const messages = conversation.messages;
    let rangeStartIndex: MessageIndex = -1;
    let rangeEndIndex = rangeStartIndex;
    for (let messageIndex = 0; messageIndex < messages.length; ++messageIndex) {
        const message = messages[messageIndex];
        if (message.timestamp) {
            if (isInDateRange(dateRange, new Date(message.timestamp))) {
                if (rangeStartIndex < 0) {
                    rangeStartIndex = messageIndex;
                }
                rangeEndIndex = messageIndex;
            } else {
                if (rangeStartIndex >= 0) {
                    break;
                }
            }
        }
    }
    if (rangeStartIndex >= 0) {
        return {
            start: { messageIndex: rangeStartIndex },
            end: { messageIndex: rangeEndIndex + 1 },
        };
    }
    return undefined;
}

/**
 * A SearchTerm consists of (a) a term (b) optional terms related to term
 * Returns the term or related term that equals the given text
 * @param searchTerm
 * @param text
 * @returns The term or related term that matched the text
 */
function getMatchingTermForText(
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
function matchSearchTermToText(
    searchTerm: SearchTerm,
    text: string | undefined,
): boolean {
    if (text) {
        return getMatchingTermForText(searchTerm, text) !== undefined;
    }
    return false;
}

function matchSearchTermToOneOfText(
    searchTerm: SearchTerm,
    textArray: string[] | undefined,
): boolean {
    if (textArray) {
        for (const text of textArray) {
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
    if (
        semanticRef.knowledgeType !== "entity" ||
        typeof searchTerm.propertyName !== "string"
    ) {
        return false;
    }
    const entity = semanticRef.knowledge as kpLib.ConcreteEntity;
    switch (<string>searchTerm.propertyName) {
        default:
            break;
        case "type":
            return matchSearchTermToOneOfText(
                searchTerm.propertyValue,
                entity.type,
            );
        case "name":
            return matchSearchTermToText(searchTerm.propertyValue, entity.name);

        case "facet.name":
            return matchPropertyNameToFacetName(
                searchTerm.propertyValue,
                entity,
            );

        case "facet.value":
            return matchPropertyValueToFacetValue(
                searchTerm.propertyValue,
                entity,
            );
    }
    return false;
}

export function matchEntityNameOrType(
    propertyValue: SearchTerm,
    entity: kpLib.ConcreteEntity,
): boolean {
    return (
        matchSearchTermToText(propertyValue, entity.name) ||
        matchSearchTermToOneOfText(propertyValue, entity.type)
    );
}

function matchPropertyNameToFacetName(
    propertyValue: SearchTerm,
    entity: kpLib.ConcreteEntity,
) {
    if (entity.facets && entity.facets.length > 0) {
        for (const facet of entity.facets) {
            if (matchSearchTermToText(propertyValue, facet.name)) {
                return true;
            }
        }
    }
    return false;
}

function matchPropertyValueToFacetValue(
    propertyValue: SearchTerm,
    entity: kpLib.ConcreteEntity,
) {
    if (entity.facets && entity.facets.length > 0) {
        for (const facet of entity.facets) {
            const facetValue = facetValueToString(facet);
            if (matchSearchTermToText(propertyValue, facetValue)) {
                return true;
            }
        }
    }
    return false;
}

function matchPropertySearchTermToAction(
    searchTerm: PropertySearchTerm,
    semanticRef: SemanticRef,
): boolean {
    if (
        semanticRef.knowledgeType !== "action" ||
        typeof searchTerm.propertyName !== "string"
    ) {
        return false;
    }
    const action = semanticRef.knowledge as kpLib.Action;
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

function matchPropertySearchTermToTag(
    searchTerm: PropertySearchTerm,
    semanticRef: SemanticRef,
) {
    if (
        semanticRef.knowledgeType !== "tag" ||
        typeof searchTerm.propertyName !== "string"
    ) {
        return false;
    }
    return matchSearchTermToText(
        searchTerm.propertyValue,
        (semanticRef.knowledge as Tag).text,
    );
}

export function matchPropertySearchTermToSemanticRef(
    searchTerm: PropertySearchTerm,
    semanticRef: SemanticRef,
): boolean {
    return (
        matchPropertySearchTermToEntity(searchTerm, semanticRef) ||
        matchPropertySearchTermToAction(searchTerm, semanticRef) ||
        matchPropertySearchTermToTag(searchTerm, semanticRef)
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
        let filtered = scoredRefs.filter((sr) => {
            const semanticRef = semanticRefs[sr.semanticRefIndex];
            const result = filter(semanticRef, sr);
            return result;
        });
        return filtered;
    }
    return undefined;
}

export function lookupTerm(
    semanticRefIndex: ITermToSemanticRefIndex,
    term: Term,
    semanticRefs: SemanticRef[],
    rangesInScope?: TextRangesInScope,
): ScoredSemanticRef[] | undefined {
    if (rangesInScope) {
        // If rangesInScope has no actual text ranges, then lookups can't possibly match
        return lookupTermFiltered(semanticRefIndex, term, semanticRefs, (sr) =>
            rangesInScope.isRangeInScope(sr.range),
        );
    }
    return semanticRefIndex.lookupTerm(term.text);
}

export function lookupProperty(
    semanticRefIndex: ITermToSemanticRefIndex,
    propertySearchTerm: PropertySearchTerm,
    semanticRefs: SemanticRef[],
    rangesInScope?: TextRangesInScope,
): ScoredSemanticRef[] | undefined {
    if (typeof propertySearchTerm.propertyName !== "string") {
        throw new Error("Not supported");
    }

    // Since we are only matching propertyValue.term
    const valueTerm = propertySearchTerm.propertyValue.term;
    propertySearchTerm = {
        propertyName: propertySearchTerm.propertyName,
        propertyValue: { term: valueTerm },
    };
    return lookupTermFiltered(
        semanticRefIndex,
        valueTerm,
        semanticRefs,
        (semanticRef) => {
            const inScope = rangesInScope
                ? rangesInScope.isRangeInScope(semanticRef.range)
                : true;
            return (
                inScope &&
                matchPropertySearchTermToSemanticRef(
                    propertySearchTerm,
                    semanticRef,
                )
            );
        },
    );
}

// Query eval expressions

export interface IQueryOpExpr<T> {
    eval(context: QueryEvalContext): T;
}

export class QueryEvalContext {
    public matchedTerms = new TermSet();
    public matchedPropertyTerms = new PropertyTermSet();
    public textRangesInScope: TextRangesInScope | undefined;

    constructor(
        public conversation: IConversation,
        /**
         * If a property secondary index is available, the query processor will use it
         */
        public propertyIndex:
            | IPropertyToSemanticRefIndex
            | undefined = undefined,
        /**
         * If a timestamp secondary index is available, the query processor will use it
         */
        public timestampIndex:
            | ITimestampToTextRangeIndex
            | undefined = undefined,
    ) {
        if (!isConversationSearchable(conversation)) {
            throw new Error(
                `${conversation.nameTag} is not initialized and cannot be searched`,
            );
        }
        this.textRangesInScope = new TextRangesInScope();
    }

    public get semanticRefIndex() {
        return this.conversation.semanticRefIndex!;
    }

    public get semanticRefs() {
        return this.conversation.semanticRefs!;
    }

    public getSemanticRef(semanticRefIndex: SemanticRefIndex): SemanticRef {
        return this.conversation.semanticRefs![semanticRefIndex];
    }

    public getMessageForRef(semanticRef: SemanticRef): IMessage {
        const messageIndex = semanticRef.range.start.messageIndex;
        return this.conversation.messages[messageIndex];
    }

    public clearMatchedTerms() {
        this.matchedTerms.clear();
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

export class MatchTermsBooleanExpr extends QueryOpExpr<SemanticRefAccumulator> {
    constructor(public getScopeExpr?: GetScopeExpr | undefined) {
        super();
    }

    protected beginMatch(context: QueryEvalContext) {
        if (this.getScopeExpr) {
            context.textRangesInScope = this.getScopeExpr.eval(context);
        }
        context.clearMatchedTerms();
    }
}

/**
 * Evaluates all child search term expressions
 * Returns their accumulated scored matches
 */
export class MatchTermsOrExpr extends MatchTermsBooleanExpr {
    constructor(
        public termExpressions: MatchTermExpr[],
        public getScopeExpr?: GetScopeExpr | undefined,
    ) {
        super(getScopeExpr);
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        super.beginMatch(context);
        const allMatches = new SemanticRefAccumulator();
        for (const matchExpr of this.termExpressions) {
            matchExpr.accumulateMatches(context, allMatches);
        }
        allMatches.calculateTotalScore();
        return allMatches;
    }
}

export class MatchTermsAndExpr extends MatchTermsBooleanExpr {
    constructor(
        public termExpressions: MatchTermExpr[],
        public getScopeExpr?: GetScopeExpr | undefined,
    ) {
        super(getScopeExpr);
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        super.beginMatch(context);

        let allMatches: SemanticRefAccumulator | undefined;
        let iTerm = 0;
        // Loop over each search term, intersecting the returned results...
        for (; iTerm < this.termExpressions.length; ++iTerm) {
            const termMatches = this.termExpressions[iTerm].eval(context);
            if (termMatches === undefined || termMatches.size === 0) {
                // We can't possibly have an 'and'
                break;
            }
            if (allMatches === undefined) {
                allMatches = termMatches;
            } else {
                allMatches = allMatches.intersect(termMatches);
            }
        }
        if (allMatches) {
            if (iTerm === this.termExpressions.length) {
                allMatches.calculateTotalScore();
                allMatches.selectWithHitCount(this.termExpressions.length);
            } else {
                // And is not possible
                allMatches.clearMatches();
            }
        }
        return allMatches ?? new SemanticRefAccumulator();
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
        if (matches.size > 0) {
            return matches;
        }
        return undefined;
    }

    public accumulateMatches(
        context: QueryEvalContext,
        matches: SemanticRefAccumulator,
    ) {
        return;
    }
}

export class MatchSearchTermExpr extends MatchTermExpr {
    constructor(
        public searchTerm: SearchTerm,
        public scoreBooster?: (
            searchTerm: SearchTerm,
            sr: SemanticRef,
            scored: ScoredSemanticRef,
        ) => ScoredSemanticRef,
    ) {
        super();
    }

    public override accumulateMatches(
        context: QueryEvalContext,
        matches: SemanticRefAccumulator,
    ): void {
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
        const matches = lookupTerm(
            context.semanticRefIndex,
            term,
            context.semanticRefs,
            context.textRangesInScope,
        );
        if (matches && this.scoreBooster) {
            for (let i = 0; i < matches.length; ++i) {
                matches[i] = this.scoreBooster(
                    this.searchTerm,
                    context.getSemanticRef(matches[i].semanticRefIndex),
                    matches[i],
                );
            }
        }
        return matches;
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
    ): ScoredSemanticRef[] | undefined {
        if (context.propertyIndex) {
            return lookupPropertyInPropertyIndex(
                context.propertyIndex,
                propertyName,
                propertyValue,
                context.semanticRefs,
                context.textRangesInScope,
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
        return lookupProperty(
            context.semanticRefIndex,
            {
                propertyName: propertyName as KnowledgePropertyName,
                propertyValue: { term: { text: propertyValue } },
            },
            context.semanticRefs,
            context.textRangesInScope,
        );
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

export class GroupSearchResultsExpr extends QueryOpExpr<
    Map<KnowledgeType, SearchResult>
> {
    constructor(
        public srcExpr: IQueryOpExpr<
            Map<KnowledgeType, SemanticRefAccumulator>
        >,
    ) {
        super();
    }

    public eval(context: QueryEvalContext): Map<KnowledgeType, SearchResult> {
        return toGroupedSearchResults(this.srcExpr.eval(context));
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

export class GetScopeExpr extends QueryOpExpr<TextRangesInScope> {
    constructor(public rangeSelectors: IQueryTextRangeSelector[]) {
        super();
    }

    public eval(context: QueryEvalContext): TextRangesInScope {
        let rangesInScope = new TextRangesInScope();
        for (const selector of this.rangeSelectors) {
            const range = selector.eval(context);
            if (range) {
                rangesInScope.addTextRanges(range);
            }
        }
        return rangesInScope;
    }
}

export class SelectInScopeExpr extends QueryOpExpr<SemanticRefAccumulator> {
    constructor(
        public sourceExpr: IQueryOpExpr<SemanticRefAccumulator>,
        public rangeSelectors: IQueryTextRangeSelector[],
    ) {
        super();
    }

    public override eval(context: QueryEvalContext): SemanticRefAccumulator {
        let semanticRefs = this.sourceExpr.eval(context);
        // Scope => collect the set of text ranges that are in scope for this query
        // - Collect all possible text ranges that may be in scope.
        // - Since ranges come from a set of range selectors, the collected ranges may overlap, or may not agree.
        //  We don't intersect/union ranges yet... future optimization
        const rangesInScope = new TextRangesInScope();
        for (const selector of this.rangeSelectors) {
            const range = selector.eval(context, semanticRefs);
            if (range) {
                rangesInScope.addTextRanges(range);
            }
        }
        semanticRefs = semanticRefs.getMatchesInScope(
            context.semanticRefs,
            rangesInScope,
        );
        return semanticRefs;
    }
}

export interface IQueryTextRangeSelector {
    eval(
        context: QueryEvalContext,
        semanticRefs?: SemanticRefAccumulator | undefined,
    ): TextRangeCollection | undefined;
}

export class TextRangesInDateRangeSelector implements IQueryTextRangeSelector {
    constructor(public dateRangeInScope: DateRange) {}

    public eval(context: QueryEvalContext): TextRangeCollection | undefined {
        const textRangesInScope = new TextRangeCollection();
        if (context.timestampIndex) {
            const textRanges = context.timestampIndex.lookupRange(
                this.dateRangeInScope,
            );
            for (const timeRange of textRanges) {
                textRangesInScope.addRange(timeRange.range);
            }
            return textRangesInScope;
        } else {
            const textRange = getTextRangeForDateRange(
                context.conversation,
                this.dateRangeInScope,
            );
            if (textRange !== undefined) {
                textRangesInScope.addRange(textRange);
            }
        }
        return textRangesInScope;
    }
}

export class TextRangesPredicateSelector implements IQueryTextRangeSelector {
    constructor(public predicates: IQuerySemanticRefPredicate[]) {}

    public eval(
        context: QueryEvalContext,
        semanticRefs?: SemanticRefAccumulator | undefined,
    ): TextRangeCollection | undefined {
        if (!semanticRefs) {
            return undefined;
        }
        if (this.predicates && this.predicates.length > 0) {
            const textRangesInScope = new TextRangeCollection();
            for (const inScopeRef of semanticRefs.getSemanticRefs(
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

export class TextRangesWithTagSelector implements IQueryTextRangeSelector {
    constructor() {}

    public eval(
        context: QueryEvalContext,
        semanticRefs: SemanticRefAccumulator,
    ): TextRangeCollection | undefined {
        let textRangesInScope: TextRangeCollection | undefined;
        for (const inScopeRef of semanticRefs.getSemanticRefs(
            context.semanticRefs,
            (sr) => sr.knowledgeType === "tag",
        )) {
            textRangesInScope ??= new TextRangeCollection();
            textRangesInScope.addRange(inScopeRef.range);
        }
        return textRangesInScope;
    }
}

export class TextRangesWithTermMatchesSelector
    implements IQueryTextRangeSelector
{
    constructor(public sourceExpr: QueryOpExpr<SemanticRefAccumulator>) {}

    public eval(context: QueryEvalContext): TextRangeCollection {
        const matches = this.sourceExpr.eval(context);
        const rangesInScope = new TextRangeCollection();
        if (matches.size > 0) {
            for (const match of matches.getMatches()) {
                const semanticRef = context.getSemanticRef(match.value);
                rangesInScope.addRange(semanticRef.range);
            }
        }
        return rangesInScope;
    }
}

export class ThreadSelector implements IQueryTextRangeSelector {
    constructor(public threads: Thread[]) {}

    public eval(context: QueryEvalContext): TextRangeCollection | undefined {
        const textRanges = new TextRangeCollection();
        for (const thread of this.threads) {
            textRanges.addRanges(thread.ranges);
        }
        return textRanges;
    }
}

export function toGroupedSearchResults(
    evalResults: Map<KnowledgeType, SemanticRefAccumulator>,
): Map<KnowledgeType, SearchResult> {
    const semanticRefMatches = new Map<KnowledgeType, SearchResult>();
    for (const [type, accumulator] of evalResults) {
        if (accumulator.size > 0) {
            semanticRefMatches.set(type, {
                termMatches: accumulator.searchTermMatches,
                semanticRefMatches: accumulator.toScoredSemanticRefs(),
            });
        }
    }
    return semanticRefMatches;
}
