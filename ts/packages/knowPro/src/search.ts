// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MessageAccumulator, SemanticRefAccumulator } from "./collections.js";
import { createAndTermGroup, createTagSearchTermGroup } from "./searchLib.js";
import {
    IConversation,
    IConversationSecondaryIndexes,
    ISemanticRefCollection,
    KnowledgeType,
    PropertySearchTerm,
    ScoredKnowledge,
    ScoredMessageOrdinal,
    ScoredSemanticRefOrdinal,
    SearchSelectExpr,
    SearchTerm,
    SearchTermGroup,
    SemanticRef,
    SemanticRefSearchResult,
    Term,
    WhenFilter,
} from "./interfaces.js";
import {
    getDistinctSemanticRefEntities,
    getDistinctSemanticRefTopics,
} from "./knowledgeMerge.js";
import { isMessageTextEmbeddingIndex } from "./messageIndex.js";
import * as q from "./query.js";
import { IQueryOpExpr } from "./query.js";
import { resolveRelatedTerms } from "./relatedTermsIndex.js";
import { conversation as kpLib } from "knowledge-processor";
import {
    BooleanOp,
    CompiledTermGroup,
    createMatchMessagesBooleanExpr,
    createMatchTermsBooleanExpr,
    isActionPropertyTerm,
    isEntityPropertyTerm,
    isPropertyTerm,
    isSearchGroupTerm,
    toRequiredSearchTerm,
} from "./compileLib.js";
import { NormalizedEmbedding } from "typeagent";
import { getTimestampedScoredSemanticRefOrdinals } from "./knowledgeLib.js";

/**
 * A Search Query expr consists:
 *  - A set of select expressions to evaluate against structured data
 *  - The raw natural language search query. This may be used to do a
 *  non-structured query
 */
export type SearchQueryExpr = {
    selectExpressions: SearchSelectExpr[];
    rawQuery?: string | undefined;
};

export interface SearchOptions {
    maxKnowledgeMatches?: number | undefined;
    exactMatch?: boolean | undefined;
    maxMessageMatches?: number | undefined;
    /**
     * The maximum # of total message characters to select
     * The query processor will ensure that the cumulative character count of message matches
     * is less than this number
     */
    maxCharsInBudget?: number | undefined;
    thresholdScore?: number | undefined;
}

export function createSearchOptions(): SearchOptions {
    return {
        exactMatch: false,
    };
}

export function createSearchOptionsTypical(): SearchOptions {
    return {
        ...createSearchOptions(),
        maxKnowledgeMatches: 50,
        maxMessageMatches: 25,
    };
}

export type ConversationSearchResult = {
    messageMatches: ScoredMessageOrdinal[];
    knowledgeMatches: Map<KnowledgeType, SemanticRefSearchResult>;
    rawSearchQuery?: string | undefined;
};

/**
 * Search a conversation for messages and knowledge that match the supplied search terms
 * @param conversation Conversation to search
 * @param searchTermGroup a group of search terms to match
 * @param whenFilter conditional filter to scope what messages and knowledge are matched
 * @param options search options
 * @returns
 */
export async function searchConversation(
    conversation: IConversation,
    searchTermGroup: SearchTermGroup,
    whenFilter?: WhenFilter,
    options?: SearchOptions,
    rawSearchQuery?: string,
): Promise<ConversationSearchResult | undefined> {
    options ??= createSearchOptions();
    const knowledgeMatches = await searchConversationKnowledge(
        conversation,
        searchTermGroup,
        whenFilter,
        options,
    );
    if (!knowledgeMatches) {
        return undefined;
    }
    // Future: Combine knowledge and message queries into single query tree
    const queryBuilder = new QueryCompiler(
        conversation,
        conversation.secondaryIndexes ?? {},
    );
    const query = await queryBuilder.compileMessageQuery(
        knowledgeMatches,
        options,
        rawSearchQuery,
    );
    const messageMatches: ScoredMessageOrdinal[] = runQuery(
        conversation,
        options,
        query,
    );
    return {
        messageMatches,
        knowledgeMatches,
        rawSearchQuery,
    };
}

/**
 * Search a conversation for knowledge that matches the given search terms
 * @param conversation Conversation to search
 * @param searchTermGroup a group of search terms to match
 * @param whenFilter conditional filter to scope what messages and knowledge are matched
 * @param options search options
 * @returns
 */
export async function searchConversationKnowledge(
    conversation: IConversation,
    searchTermGroup: SearchTermGroup,
    whenFilter?: WhenFilter,
    options?: SearchOptions,
): Promise<Map<KnowledgeType, SemanticRefSearchResult> | undefined> {
    if (!q.isConversationSearchable(conversation)) {
        return undefined;
    }
    options ??= createSearchOptions();
    const queryBuilder = new QueryCompiler(
        conversation,
        conversation.secondaryIndexes ?? {},
    );
    const query = await queryBuilder.compileKnowledgeQuery(
        searchTermGroup,
        whenFilter,
        options,
    );
    return runQuery(conversation, options, query);
}

/**
 * Search the conversation messages using similarity to the provided text
 * Found messages can be filtered by date ranges and other scoping provided
 * in the filter
 * @param conversation
 * @param queryText
 * @param whenFilter
 * @param options
 * @returns
 */
export async function searchConversationByTextSimilarity(
    conversation: IConversation,
    queryText: string,
    whenFilter?: WhenFilter,
    options?: SearchOptions,
): Promise<ConversationSearchResult | undefined> {
    options ??= createSearchOptions();
    // Future: Combine knowledge and message queries into single query tree
    const queryBuilder = new QueryCompiler(
        conversation,
        conversation.secondaryIndexes ?? {},
    );
    const query = await queryBuilder.compileMessageSimilarityQuery(
        queryText,
        whenFilter,
        options,
    );
    const messageMatches: ScoredMessageOrdinal[] =
        query !== undefined ? runQuery(conversation, options, query) : [];
    return {
        messageMatches,
        knowledgeMatches: new Map(),
        rawSearchQuery: queryText,
    };
}

/**
 * Run a search query over the given conversation
 * @param conversation
 * @param query
 * @returns The result of running each individual sub query
 */
export async function runSearchQuery(
    conversation: IConversation,
    query: SearchQueryExpr,
    options?: SearchOptions,
): Promise<ConversationSearchResult[]> {
    options ??= createSearchOptions();
    const results: ConversationSearchResult[] = [];
    for (const expr of query.selectExpressions) {
        const searchResults = await searchConversation(
            conversation,
            expr.searchTermGroup,
            expr.when,
            options,
            query.rawQuery,
        );
        if (searchResults) {
            results.push(searchResults);
        }
    }
    return results;
}

/**
 * Run multiple queries
 * @param conversation
 * @param queries queries to run
 * @param options
 * @returns
 */
export async function runSearchQueries(
    conversation: IConversation,
    queries: SearchQueryExpr[],
    options?: SearchOptions,
): Promise<ConversationSearchResult[][]> {
    // FUTURE: do these in parallel
    const results: ConversationSearchResult[][] = [];
    for (let i = 0; i < queries.length; ++i) {
        const result = await runSearchQuery(conversation, queries[i], options);
        results.push(result);
    }
    return results;
}

/**
 * Run the search query. For each selectExpr:
 * - only match messages using similarity to the rawQuery on each expression
 * - scope messages using the when filter
 * @param conversation
 * @param query
 * @param options
 * @returns
 */
export async function runSearchQueryTextSimilarity(
    conversation: IConversation,
    query: SearchQueryExpr,
    options?: SearchOptions,
): Promise<ConversationSearchResult[]> {
    options ??= createSearchOptions();
    const results: ConversationSearchResult[] = [];
    for (const expr of query.selectExpressions) {
        if (query.rawQuery) {
            const searchResults = await searchConversationByTextSimilarity(
                conversation,
                query.rawQuery,
                expr.when,
                options,
            );
            if (searchResults) {
                results.push(searchResults);
            }
        }
    }
    return results;
}

/**
 * Merge any entity matches by name, merging in their types and facets
 * The resulting distinct array of entities
 * @param semanticRefs
 * @param searchResults
 * @param topK Return topK scoring distinct entities
 * @returns
 */
export function getDistinctEntityMatches(
    semanticRefs: ISemanticRefCollection,
    searchResults: ScoredSemanticRefOrdinal[],
    topK?: number,
): ScoredKnowledge[] {
    return getDistinctSemanticRefEntities(semanticRefs, searchResults, topK);
}

/**
 * Return an array of distinct topics
 * @param semanticRefs
 * @param searchResults
 * @param topK Return topK scoring distinct topics
 * @returns
 */
export function getDistinctTopicMatches(
    semanticRefs: ISemanticRefCollection,
    searchResults: ScoredSemanticRefOrdinal[],
    topK?: number,
): ScoredKnowledge[] {
    return getDistinctSemanticRefTopics(semanticRefs, searchResults, topK);
}

export enum ResultSortType {
    Score,
    Ordinal,
    Timestamp,
}

/**
 * Sort knowledge results
 * @param conversation
 * @param searchResults Results to sort
 * @param sortType
 * @param asc (Default) False. Sort in ascending or descending order
 * @returns
 */
export function sortKnowledgeResults(
    conversation: IConversation,
    searchResults: ScoredSemanticRefOrdinal[],
    sortType: ResultSortType,
    asc: boolean = false,
): ScoredSemanticRefOrdinal[] {
    switch (sortType) {
        default:
            if (asc) {
                searchResults.sort((x, y) => x.score - y.score);
            } else {
                searchResults.sort((x, y) => y.score - x.score);
            }
            return searchResults;
        case ResultSortType.Ordinal:
            if (asc) {
                searchResults.sort(
                    (x, y) => x.semanticRefOrdinal - y.semanticRefOrdinal,
                );
            } else {
                searchResults.sort(
                    (x, y) => y.semanticRefOrdinal - x.semanticRefOrdinal,
                );
            }
            return searchResults;
        case ResultSortType.Timestamp:
            const semanticRefsT = getTimestampedScoredSemanticRefOrdinals(
                conversation,
                searchResults,
            );
            if (asc) {
                semanticRefsT.sort(
                    (x, y) => x.timestamp.getTime() - y.timestamp.getTime(),
                );
            } else {
                semanticRefsT.sort(
                    (x, y) => y.timestamp.getTime() - x.timestamp.getTime(),
                );
            }
            return semanticRefsT.map((sr) => sr.value);
    }
}

function runQuery<T = any>(
    conversation: IConversation,
    options: SearchOptions | undefined,
    query: IQueryOpExpr<T>,
): T {
    const secondaryIndexes: IConversationSecondaryIndexes =
        conversation.secondaryIndexes ?? {};
    return query.eval(
        new q.QueryEvalContext(
            conversation,
            secondaryIndexes.propertyToSemanticRefIndex,
            secondaryIndexes.timestampIndex,
        ),
    );
}

class QueryCompiler {
    // All SearchTerms used which compiling the 'select' portion of the query
    private allSearchTerms: CompiledTermGroup[] = [];
    // All search terms used while compiling predicates in the query
    private allPredicateSearchTerms: CompiledTermGroup[] = [];
    private allScopeSearchTerms: CompiledTermGroup[] = [];

    constructor(
        public conversation: IConversation,
        public secondaryIndexes?: IConversationSecondaryIndexes | undefined,
        public entityTermMatchWeight: number = 100,
        public defaultTermMatchWeight: number = 10,
        public relatedIsExactThreshold: number = 0.95,
    ) {}

    public async compileKnowledgeQuery(
        terms: SearchTermGroup,
        filter?: WhenFilter,
        options?: SearchOptions,
    ) {
        let query = await this.compileQuery(terms, filter, options);

        const exactMatch = options?.exactMatch ?? false;
        if (!exactMatch) {
            // For all individual SearchTerms created during query compilation, resolve any related terms
            await this.resolveRelatedTerms(this.allSearchTerms, true);
            await this.resolveRelatedTerms(this.allPredicateSearchTerms, false);
            await this.resolveRelatedTerms(this.allScopeSearchTerms, false);
        }

        return new q.GroupSearchResultsExpr(query);
    }

    public async compileMessageQuery(
        knowledge:
            | IQueryOpExpr<Map<KnowledgeType, SemanticRefSearchResult>>
            | Map<KnowledgeType, SemanticRefSearchResult>,
        options?: SearchOptions,
        rawQueryText?: string,
    ): Promise<IQueryOpExpr> {
        let query: IQueryOpExpr = new q.MessagesFromKnowledgeExpr(knowledge);
        if (options) {
            query = await this.compileMessageReRank(
                query,
                rawQueryText,
                options,
            );
            if (options.maxCharsInBudget && options.maxCharsInBudget > 0) {
                query = new q.SelectMessagesInCharBudget(
                    query,
                    options.maxCharsInBudget,
                );
            }
        }
        query = new q.GetScoredMessagesExpr(query);
        return query;
    }

    public async compileMessageSimilarityQuery(
        query: string | NormalizedEmbedding,
        whenFilter?: WhenFilter,
        options?: SearchOptions,
    ): Promise<IQueryOpExpr | undefined> {
        const messageIndex = this.conversation.secondaryIndexes?.messageIndex;
        if (messageIndex !== undefined) {
            const scopeExpr = await this.compileScope(undefined, whenFilter);
            return this.compileMessageSimilarity(query, scopeExpr, options);
        }
        return undefined;
    }

    private async compileQuery(
        searchTermGroup: SearchTermGroup,
        filter?: WhenFilter,
        options?: SearchOptions,
    ): Promise<IQueryOpExpr<Map<KnowledgeType, SemanticRefAccumulator>>> {
        let selectExpr = this.compileSelect(
            searchTermGroup,
            await this.compileScope(searchTermGroup, filter),
            options,
        );
        // Constrain the select with scopes and 'where'
        if (filter) {
            selectExpr = new q.WhereSemanticRefExpr(
                selectExpr,
                this.compileWhere(filter),
            );
        }
        // And lastly, select 'TopN' and group knowledge by type
        return new q.SelectTopNKnowledgeGroupExpr(
            new q.GroupByKnowledgeTypeExpr(selectExpr),
            options?.maxKnowledgeMatches,
        );
    }

    private compileSelect(
        termGroup: SearchTermGroup,
        scopeExpr?: q.GetScopeExpr,
        options?: SearchOptions,
    ) {
        // Select is a combination of ordinary search terms and property search terms
        let [searchTermUsed, selectExpr] = this.compileSearchGroupTerms(
            termGroup,
            scopeExpr,
        );
        this.allSearchTerms.push(...searchTermUsed);
        return selectExpr;
    }

    private compileSearchGroupTerms(
        searchGroup: SearchTermGroup,
        scopeExpr?: q.GetScopeExpr,
    ): [CompiledTermGroup[], q.IQueryOpExpr<SemanticRefAccumulator>] {
        return this.compileSearchGroup(
            searchGroup,
            (termExpressions, booleanOp, scope) => {
                return createMatchTermsBooleanExpr(
                    termExpressions,
                    booleanOp,
                    scope,
                );
            },
            scopeExpr,
        );
    }

    public compileSearchGroupMessages(
        searchGroup: SearchTermGroup,
    ): [CompiledTermGroup[], q.IQueryOpExpr<MessageAccumulator>] {
        return this.compileSearchGroup(
            searchGroup,
            (termExpressions, booleanOp) => {
                return createMatchMessagesBooleanExpr(
                    termExpressions,
                    booleanOp,
                );
            },
        );
    }

    public compileSearchGroup(
        searchGroup: SearchTermGroup,
        createOp: (
            termExpressions: q.IQueryOpExpr[],
            booleanOp: BooleanOp,
            scopeExpr?: q.GetScopeExpr,
        ) => IQueryOpExpr,
        scopeExpr?: q.GetScopeExpr,
    ): [CompiledTermGroup[], q.IQueryOpExpr] {
        const compiledTerms: CompiledTermGroup[] = [
            { booleanOp: searchGroup.booleanOp, terms: [] },
        ];
        const termExpressions: q.IQueryOpExpr[] = [];
        for (const term of searchGroup.terms) {
            if (isPropertyTerm(term)) {
                termExpressions.push(this.compilePropertyTerm(term));
                if (typeof term.propertyName !== "string") {
                    compiledTerms[0].terms.push(
                        toRequiredSearchTerm(term.propertyName),
                    );
                }
                compiledTerms[0].terms.push(
                    toRequiredSearchTerm(term.propertyValue),
                );
            } else if (isSearchGroupTerm(term)) {
                const [nestedTerms, groupExpr] = this.compileSearchGroup(
                    term,
                    createOp,
                );
                compiledTerms.push(...nestedTerms);
                termExpressions.push(groupExpr);
            } else {
                termExpressions.push(this.compileSearchTerm(term));
                compiledTerms[0].terms.push(term);
            }
        }
        let boolExpr = createOp(
            termExpressions,
            searchGroup.booleanOp,
            scopeExpr,
        );
        return [compiledTerms, boolExpr];
    }

    private compileSearchTerm(
        term: SearchTerm,
    ): IQueryOpExpr<SemanticRefAccumulator | undefined> {
        const boostWeight =
            this.entityTermMatchWeight / this.defaultTermMatchWeight;
        return new q.MatchSearchTermExpr(term, (term, sr, scored) =>
            this.boostEntities(term, sr, scored, boostWeight),
        );
    }

    private compilePropertyTerm(
        term: PropertySearchTerm,
    ): IQueryOpExpr<SemanticRefAccumulator | undefined> {
        switch (term.propertyName) {
            default:
                if (isEntityPropertyTerm(term)) {
                    term.propertyValue.term.weight ??=
                        this.entityTermMatchWeight;
                }
                return new q.MatchPropertySearchTermExpr(term);
            case "tag":
                return new q.MatchTagExpr(term.propertyValue);
            case "topic":
                return new q.MatchTopicExpr(term.propertyValue);
        }
    }

    private async compileScope(
        termGroup?: SearchTermGroup,
        filter?: WhenFilter | undefined,
    ): Promise<q.GetScopeExpr | undefined> {
        let scopeSelectors: q.IQueryTextRangeSelector[] | undefined;
        // First, use any provided date ranges to select scope
        if (filter && filter.dateRange) {
            scopeSelectors ??= [];
            scopeSelectors.push(
                new q.TextRangesInDateRangeSelector(filter.dateRange),
            );
        }
        //
        // Apply 'OUTER' scope
        //
        // If specific scoping terms were provided
        if (filter && filter.scopeDefiningTerms !== undefined) {
            scopeSelectors ??= [];
            this.addTermsScopeSelector(
                filter.scopeDefiningTerms,
                scopeSelectors,
            );
        } else if (termGroup) {
            // Treat any actions as inherently scope selecting.
            let actionTermsGroup =
                this.getActionTermsFromSearchGroup(termGroup);
            if (actionTermsGroup !== undefined) {
                scopeSelectors ??= [];
                this.addTermsScopeSelector(actionTermsGroup, scopeSelectors);
            }
        }
        // Include any ranges directly provided by the caller
        if (filter && filter.textRangesInScope) {
            scopeSelectors ??= [];
            scopeSelectors?.push(
                new q.TextRangeSelector(filter.textRangesInScope),
            );
        }
        // Tags...
        if (filter && filter.tags && filter.tags.length > 0) {
            scopeSelectors ??= [];
            this.addTermsScopeSelector(
                createTagSearchTermGroup(filter.tags),
                scopeSelectors,
            );
        }
        // If a thread index is available...
        const threads = this.secondaryIndexes?.threads;
        if (filter && filter.threadDescription && threads) {
            const threadsInScope = await threads.lookupThread(
                filter.threadDescription,
            );
            if (threadsInScope) {
                scopeSelectors ??= [];
                scopeSelectors.push(
                    new q.ThreadSelector(
                        threadsInScope.map(
                            (t) => threads.threads[t.threadOrdinal],
                        ),
                    ),
                );
            }
        }
        return scopeSelectors && scopeSelectors.length > 0
            ? new q.GetScopeExpr(scopeSelectors)
            : undefined;
    }

    private addTermsScopeSelector(
        termGroup: SearchTermGroup,
        scopeSelectors: q.IQueryTextRangeSelector[],
    ) {
        if (termGroup.terms.length > 0) {
            const [searchTermsUsed, selectExpr] =
                this.compileSearchGroupMessages(termGroup);
            scopeSelectors.push(
                new q.TextRangesFromMessagesSelector(selectExpr),
            );
            this.allScopeSearchTerms.push(...searchTermsUsed);
        }
    }

    private compileWhere(filter: WhenFilter): q.IQuerySemanticRefPredicate[] {
        let predicates: q.IQuerySemanticRefPredicate[] = [];
        if (filter.knowledgeType) {
            predicates.push(new q.KnowledgeTypePredicate(filter.knowledgeType));
        }
        return predicates;
    }

    private async compileMessageReRank(
        srcExpr: IQueryOpExpr<MessageAccumulator>,
        rawQueryText?: string,
        options?: SearchOptions,
    ): Promise<IQueryOpExpr> {
        const messageIndex = this.conversation.secondaryIndexes?.messageIndex;
        if (
            messageIndex &&
            rawQueryText &&
            isMessageTextEmbeddingIndex(messageIndex) &&
            messageIndex.size > 0
        ) {
            // If embeddings supported, and there are too many matches, try to re-rank using similarity matching
            const embedding =
                await messageIndex.generateEmbedding(rawQueryText);
            return new q.RankMessagesBySimilarityExpr(
                srcExpr,
                embedding,
                options?.maxMessageMatches,
                options?.thresholdScore,
            );
        } else if (
            options?.maxMessageMatches !== undefined &&
            options.maxMessageMatches > 0
        ) {
            return new q.SelectTopNExpr(srcExpr, options.maxMessageMatches);
        } else {
            return new q.NoOpExpr(srcExpr);
        }
    }

    private async compileMessageSimilarity(
        query: string | NormalizedEmbedding,
        scopeExpr?: q.GetScopeExpr,
        options?: SearchOptions,
    ): Promise<IQueryOpExpr | undefined> {
        const messageIndex = this.conversation.secondaryIndexes?.messageIndex;
        if (messageIndex !== undefined) {
            // If embeddings supported, and there are too many matches, try to re-rank using similarity matching
            const embedding =
                typeof query === "string"
                    ? isMessageTextEmbeddingIndex(messageIndex)
                        ? await messageIndex.generateEmbedding(query)
                        : undefined
                    : query;
            if (embedding) {
                return new q.MatchMessagesBySimilarityExpr(
                    embedding,
                    options?.maxMessageMatches,
                    options?.thresholdScore,
                    scopeExpr,
                );
            }
        }
        return undefined;
    }

    private getActionTermsFromSearchGroup(
        searchGroup: SearchTermGroup,
    ): SearchTermGroup | undefined {
        let actionGroup: SearchTermGroup | undefined;
        for (const term of searchGroup.terms) {
            if (isPropertyTerm(term) && isActionPropertyTerm(term)) {
                actionGroup ??= createAndTermGroup();
                actionGroup.terms.push(term);
            }
        }
        return actionGroup;
    }

    private async resolveRelatedTerms(
        compiledTerms: CompiledTermGroup[],
        dedupe: boolean,
        filter?: WhenFilter,
    ) {
        compiledTerms.forEach((ct) =>
            this.validateAndPrepareSearchTerms(ct.terms),
        );
        if (this.secondaryIndexes?.termToRelatedTermsIndex) {
            await resolveRelatedTerms(
                this.secondaryIndexes.termToRelatedTermsIndex,
                compiledTerms,
                dedupe,
            );
            // Ensure that the resolved terms are valid etc.
            compiledTerms.forEach((ct) =>
                this.validateAndPrepareSearchTerms(ct.terms),
            );
        }
    }

    private validateAndPrepareSearchTerms(searchTerms: SearchTerm[]): void {
        for (const searchTerm of searchTerms) {
            this.validateAndPrepareSearchTerm(searchTerm);
        }
    }

    private validateAndPrepareSearchTerm(searchTerm: SearchTerm): boolean {
        if (!this.validateAndPrepareTerm(searchTerm.term)) {
            return false;
        }
        // Matching the term - exact match - counts for more than matching related terms
        // Therefore, we boost any matches where the term matches directly...
        searchTerm.term.weight ??= this.defaultTermMatchWeight;
        if (searchTerm.relatedTerms !== undefined) {
            for (const relatedTerm of searchTerm.relatedTerms) {
                if (!this.validateAndPrepareTerm(relatedTerm)) {
                    return false;
                }
                // If related term is *really* similar to the main term, score it the same
                if (
                    relatedTerm.weight &&
                    relatedTerm.weight >= this.relatedIsExactThreshold
                ) {
                    relatedTerm.weight = this.defaultTermMatchWeight;
                }
            }
        }
        return true;
    }

    /**
     * Currently, just changes the case of a term
     *  But here, we may do other things like:
     * - Check for noise terms
     * - Do additional rewriting
     * - Additional checks that *reject* certain search terms
     * Return false if the term should be rejected
     */
    private validateAndPrepareTerm(term: Term | undefined): boolean {
        if (term) {
            term.text = term.text.toLowerCase();
        }
        return true;
    }

    /**
     * If the name or type of an entity matched, boost its score
     * @param searchTerm
     * @param sr
     * @param scoredRef
     * @param boostWeight
     * @returns
     */
    private boostEntities(
        searchTerm: SearchTerm,
        sr: SemanticRef,
        scoredRef: ScoredSemanticRefOrdinal,
        boostWeight: number,
    ): ScoredSemanticRefOrdinal {
        if (
            sr.knowledgeType === "entity" &&
            q.matchEntityNameOrType(
                searchTerm,
                sr.knowledge as kpLib.ConcreteEntity,
            )
        ) {
            scoredRef = {
                semanticRefOrdinal: scoredRef.semanticRefOrdinal,
                score: scoredRef.score * boostWeight,
            };
        }
        return scoredRef;
    }
}

export function hasConversationResults(
    results: ConversationSearchResult[],
): boolean {
    if (results.length === 0) {
        return false;
    }
    return results.some((r) => {
        return r.knowledgeMatches.size > 0 || r.messageMatches.length > 0;
    });
}

export function hasConversationResult(
    result: ConversationSearchResult,
): boolean {
    return result.knowledgeMatches.size > 0 || result.messageMatches.length > 0;
}
