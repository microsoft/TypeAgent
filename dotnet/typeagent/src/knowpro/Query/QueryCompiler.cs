// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading.Tasks;

namespace TypeAgent.KnowPro.Query;

public class QueryCompilerSettings
{
    /// <summary>
    /// Default weight for entity matches, which are more meaningful
    /// </summary>
    public float EntityTermMatchWeight { get; set; } = 100;

    /// <summary>
    /// How much to weigh the primary term of a SearchTerm by default.
    /// Weigh this higher because it is exactly what the user provided
    /// Does not apply to RelatedTerms, which are weighted by their similarity 
    /// </summary>
    public float DefaultTermMatchWeight { get; set; } = 10;

    /// <summary>
    /// Related Terms have weights assigned based on their (fuzzy) similarity to source terms
    /// At some point, they are so similar that we treat them as exactly the same
    /// </summary>
    public double RelatedIsExactThreshold { get; set; } = 0.95;

}

internal class QueryCompiler
{
    static QueryCompilerSettings s_defaultSettings = new QueryCompilerSettings();

    private IConversation _conversation;
    private IConversationCache _conversationCache;
    private List<CompiledTermGroup> _allSearchTerms;
    private List<CompiledTermGroup> _allScopeSearchTerms;
    private CancellationToken _cancellationToken;


    public QueryCompiler(
        IConversation conversation,
        IConversationCache conversationCache,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(conversation, nameof(conversation));
        ArgumentVerify.ThrowIfNull(conversationCache, nameof(conversationCache));

        _conversation = conversation;
        _conversationCache = conversationCache;
        _allSearchTerms = [];
        _allScopeSearchTerms = [];
        Settings = conversation.Settings.QueryCompilerSettings ?? s_defaultSettings;
        _cancellationToken = cancellationToken;
    }

    public QueryCompilerSettings Settings { get; }

    public async ValueTask<QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>>> CompileKnowledgeQueryAsync(
        SearchTermGroup searchGroup,
        WhenFilter? whenFilter,
        SearchOptions? searchOptions
    )
    {
        var queryExpr = await CompileQueryAsync(searchGroup, whenFilter).ConfigureAwait(false);
        QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>> resultExpr = new GroupSearchResultsExpr(queryExpr);

        bool exactMatch = (searchOptions?.ExactMatch is not null) && searchOptions.ExactMatch.Value;
        if (!exactMatch)
        {
            await ResolveRelatedTermsAsync(_allSearchTerms, true);
            await ResolveRelatedTermsAsync(_allScopeSearchTerms, false);
        }

        return resultExpr;
    }

    public async ValueTask<QueryOpExpr<List<ScoredMessageOrdinal>>> CompileMessageQueryAsync(
        QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>> knowledgeMatches,
        SearchOptions? options,
        string? rawSearchQuery
    )
    {
        QueryOpExpr<MessageAccumulator> query = new MessagesFromKnowledgeExpr(knowledgeMatches);
        if (options is not null)
        {
            query = await CompileMessageReRankAsync(
                query,
                rawSearchQuery,
                options
            ).ConfigureAwait(false);

            if (options.MaxCharsInBudget is not null && options.MaxCharsInBudget.Value > 0)
            {
                query = new SelectMessagesInCharBudget(query, options.MaxCharsInBudget.Value);
            }
        }

        QueryOpExpr<List<ScoredMessageOrdinal>> messagesExpr = new GetScoredMessagesExpr(query);
        return messagesExpr;
    }

    public async ValueTask<QueryOpExpr<IList<ScoredMessageOrdinal>>> CompileMessageSimilarityQueryAsync(
        string query,
        WhenFilter? whenFilter,
        SearchOptions? options
    )
    {
        IMessageTextIndex messageIndex = _conversation.SecondaryIndexes.MessageIndex;
        GetScopeExpr? scopeExpr = await CompileScopeAsync(null, whenFilter);
        return CompileMessageSimilarity(query, scopeExpr, options);
    }

    public (List<CompiledTermGroup>, QueryOpExpr<SemanticRefAccumulator>) CompileSearchGroupTerms(
        SearchTermGroup searchGroup,
        GetScopeExpr? scopeExpr,
        IQuerySemanticRefPredicate? matchFilter = null
    )
    {
        List<CompiledTermGroup> compiledTerms = [new CompiledTermGroup(searchGroup.BooleanOp)];

        List<QueryOpExpr<SemanticRefAccumulator?>> termExpressions = [];
        foreach (var term in searchGroup.Terms)
        {
            switch (term)
            {
                default:
                    break;

                case PropertySearchTerm propertyTerm:
                    var propertyExpr = CompileMatchFilter(
                        CompilePropertyTerm(propertyTerm),
                        matchFilter
                    );
                    termExpressions.Add(propertyExpr);
                    if (propertyTerm.PropertyName is PropertyNameSearchTerm kp)
                    {
                        compiledTerms[0].Terms.Add(kp.Value.ToRequired());
                    }
                    compiledTerms[0].Terms.Add(propertyTerm.PropertyValue.ToRequired());
                    break;

                case SearchTermGroup subGroup:
                    var (nestedTerms, groupExpr) = CompileSearchGroupTerms(
                        subGroup,
                        null,  // Apply scopes on the outermost expression only
                        matchFilter
                    );
                    compiledTerms.AddRange(nestedTerms);
                    termExpressions.Add(groupExpr);
                    break;

                case SearchTerm searchTerm:
                    var searchTermExpr = CompileMatchFilter(
                        CompileSearchTerm(searchTerm),
                        matchFilter
                    );
                    termExpressions.Add(searchTermExpr);
                    compiledTerms[0].Terms.Add(searchTerm);
                    break;

            }
        }

        var boolExpr = MatchTermsBooleanExpr.Create(
            termExpressions,
            searchGroup.BooleanOp,
            scopeExpr
        );
        return (compiledTerms, boolExpr);
    }

    public (List<CompiledTermGroup>, QueryOpExpr<MessageAccumulator>) CompileMessageSearchGroup(
       SearchTermGroup searchGroup,
       IQuerySemanticRefPredicate? matchFilter = null
   )
    {
        List<CompiledTermGroup> compiledTerms = [new CompiledTermGroup(searchGroup.BooleanOp)];

        List<QueryOpExpr> termExpressions = [];
        foreach (var term in searchGroup.Terms)
        {
            switch (term)
            {
                default:
                    break;

                case PropertySearchTerm propertyTerm:
                    var propertyExpr = CompileMatchFilter(
                        CompilePropertyTerm(propertyTerm),
                        matchFilter
                    );
                    termExpressions.Add(propertyExpr);
                    if (propertyTerm.PropertyName is PropertyNameSearchTerm kp)
                    {
                        compiledTerms[0].Terms.Add(kp.Value.ToRequired());
                    }
                    compiledTerms[0].Terms.Add(propertyTerm.PropertyValue.ToRequired());
                    break;

                case SearchTermGroup subGroup:
                    var (nestedTerms, groupExpr) = CompileSearchGroupTerms(
                        subGroup,
                        null,  // Apply scopes on the outermost expression only
                        matchFilter
                    );
                    compiledTerms.AddRange(nestedTerms);
                    termExpressions.Add(groupExpr);
                    break;

                case SearchTerm searchTerm:
                    var searchTermExpr = CompileMatchFilter(
                        CompileSearchTerm(searchTerm),
                        matchFilter
                    );
                    termExpressions.Add(searchTermExpr);
                    compiledTerms[0].Terms.Add(searchTerm);
                    break;
            }
        }

        var boolExpr = MatchMessagesBooleanExpr.Create(
            termExpressions,
            searchGroup.BooleanOp
        );
        return (compiledTerms, boolExpr);
    }

    private async Task<QueryOpExpr<IDictionary<KnowledgeType, SemanticRefAccumulator>>> CompileQueryAsync(
        SearchTermGroup searchGroup,
        WhenFilter? whenFilter
    )
    {
        var scopeExpr = await CompileScopeAsync(searchGroup, whenFilter).ConfigureAwait(false);

        var selectExpr = CompileSelect(searchGroup, scopeExpr);

        return new SelectTopNKnowledgeGroupExpr(
            new GroupByKnowledgeTypeExpr(selectExpr)
        );
    }

    private QueryOpExpr<SemanticRefAccumulator> CompileSelect(
        SearchTermGroup searchGroup,
        GetScopeExpr? scopeExpr
    )
    {
        var (searchTermsUsed, selectExpr) = CompileSearchGroupTerms(searchGroup, scopeExpr);
        _allSearchTerms.AddRange(searchTermsUsed);
        return selectExpr;
    }

    private QueryOpExpr<SemanticRefAccumulator?> CompileSearchTerm(SearchTerm searchTerm)
    {
        float boostWeight = Settings.EntityTermMatchWeight / Settings.DefaultTermMatchWeight;

        return new MatchSearchTermExpr(
            searchTerm,
            (semanticRef, scoredOrdinal) =>
        {
            return Ranker.BoostEntities(semanticRef, scoredOrdinal, boostWeight);
        });
    }

    private QueryOpExpr<SemanticRefAccumulator?> CompilePropertyTerm(PropertySearchTerm propertyTerm)
    {
        if (propertyTerm.PropertyName is KnowledgePropertyNameSearchTerm term)
        {
            switch (term.Value)
            {
                default:
                    if (term.Value.IsEntityProperty)
                    {
                        propertyTerm.PropertyValue.Term.Weight ??= Settings.EntityTermMatchWeight;
                    }
                    return new MatchPropertySearchTermExpr(propertyTerm);
                case "tag":
                case "topic":
                    // TODO
                    throw new NotImplementedException();
            }
        }
        else
        {
            return new MatchPropertySearchTermExpr(propertyTerm);
        }
    }

    private QueryOpExpr<SemanticRefAccumulator> CompileMatchFilter(
        QueryOpExpr<SemanticRefAccumulator> termExpr,
        IQuerySemanticRefPredicate matchFilter
)
    {
        if (matchFilter is not null)
        {
            termExpr = new FilterMatchTermExpr(termExpr, matchFilter);
        }
        return termExpr;
    }

    private ValueTask<GetScopeExpr?> CompileScopeAsync(SearchTermGroup? termGroup, WhenFilter? filter)
    {
        if (termGroup is null && filter is null)
        {
            return ValueTask.FromResult<GetScopeExpr>(null);

        }
        var scopeSelectors = new List<IQueryTextRangeSelector>();

        if (filter is not null)
        {
            if (filter.DateRange is not null)
            {
                scopeSelectors.Add(new TextRangesInDateRangeSelector(filter.DateRange.Value));
            }

            if (!filter.ScopeDefiningTerms.IsNullOrEmpty())
            {
                AddTermsScopeSelector(filter.ScopeDefiningTerms, scopeSelectors);
            }
            else if (!termGroup.IsNullOrEmpty())
            {
                // Treat any actions as inherently scope selecting.
                var actionTermsGroup = GetActionTermsFromSearchGroup(termGroup);
                if (actionTermsGroup is not null)
                {
                    AddTermsScopeSelector(actionTermsGroup, scopeSelectors);
                }
            }

            if (!filter.TextRangesInScope.IsNullOrEmpty())
            {
                scopeSelectors.Add(new QueryTextRangeSelector(filter.TextRangesInScope));
            }

            if (!filter.Tags.IsNullOrEmpty())
            {
                var tagGroup = new SearchTermGroup(SearchTermBooleanOp.OrMax)
                {
                    { KnowledgePropertyName.Tag, filter.Tags, true }
                };
                AddTermsScopeSelector(tagGroup, scopeSelectors);
            }

            if (!filter.TagMatchingTerms.IsNullOrEmpty())
            {
                AddTermsScopeSelector(
                    termGroup,
                    scopeSelectors,
                    new KnowledgeTypePredicate(KnowledgeType.STag)
                );
            }
        }
        else if (!termGroup.IsNullOrEmpty())
        {
            // Treat any actions as inherently scope selecting.
            var actionTermsGroup = GetActionTermsFromSearchGroup(termGroup);
            if (actionTermsGroup is not null)
            {
                AddTermsScopeSelector(actionTermsGroup, scopeSelectors);
            }
        }

        GetScopeExpr? scopeExpr = !scopeSelectors.IsNullOrEmpty()
            ? new GetScopeExpr(scopeSelectors)
            : null;
        return ValueTask.FromResult(scopeExpr);
    }

    private async ValueTask<QueryOpExpr<MessageAccumulator>> CompileMessageReRankAsync(
        QueryOpExpr<MessageAccumulator> srcExpr,
        string? rawQueryText,
        SearchOptions? options
    )
    {
        var messageIndex = _conversation.SecondaryIndexes.MessageIndex;
        int messageCount = await messageIndex.GetCountAsync(
            _cancellationToken
        ).ConfigureAwait(false);

        if (!string.IsNullOrEmpty(rawQueryText) && messageCount > 0)
        {
            return new RankMessagesBySimilarityExpr(
                srcExpr,
                rawQueryText,
                options?.MaxMessageMatches,
                options?.ThresholdScore
            );
        }
        else if (
            options?.MaxMessageMatches is not null &&
            options.MaxMessageMatches.Value > 0
        )
        {
            return new SelectTopNExpr<MessageAccumulator, int>(srcExpr, options.MaxMessageMatches);
        }
        else
        {
            return new NoOpExpr<MessageAccumulator>(srcExpr);
        }
    }

    private QueryOpExpr<IList<ScoredMessageOrdinal>> CompileMessageSimilarity(
        string query,
        GetScopeExpr? scopeExpr,
        SearchOptions? options
    )
    {
        var messageIndex = _conversation.SecondaryIndexes.MessageIndex;
        return new MatchMessagesBySimilarityExpr(
            query,
            options?.MaxMessageMatches,
            options?.ThresholdScore,
            scopeExpr
        );
    }

    private void AddTermsScopeSelector(
        SearchTermGroup termGroup,
        List<IQueryTextRangeSelector> scopeSelectors,
        IQuerySemanticRefPredicate? predicate = null
    )
    {
        var (searchTermsUsed, selectExpr) = CompileMessageSearchGroup(termGroup, predicate);
        scopeSelectors.Add(new TextRangesFromMessagesSelector(selectExpr));
        _allScopeSearchTerms.AddRange(searchTermsUsed);
    }

    private SearchTermGroup? GetActionTermsFromSearchGroup(SearchTermGroup searchGroup)
    {
        SearchTermGroup? actionGroup = null;
        foreach (var term in searchGroup.Terms)
        {
            if (term is PropertySearchTerm pst && pst.IsActionPropertyTerm())
            {
                actionGroup ??= new SearchTermGroup(SearchTermBooleanOp.And);
                actionGroup.Terms.Add(term);
            }
        }
        return actionGroup;
    }

    private async ValueTask ResolveRelatedTermsAsync(
        List<CompiledTermGroup> compiledTerms,
        bool dedupe
    )
    {
        compiledTerms.ForEach((ct) => ValidateAndPrepare(ct.Terms));

        await ResolveRelatedTermsAsync(
            _conversation.SecondaryIndexes.TermToRelatedTermsIndex.Aliases,
            _conversationCache.RelatedTermsFuzzy,
            compiledTerms,
            dedupe
        ).ConfigureAwait(false);

        // This second pass ensures any related terms are valid etc
        compiledTerms.ForEach((ct) => ValidateAndPrepare(ct.Terms));
    }

    private async ValueTask ResolveRelatedTermsAsync(
        ITermToRelatedTermsLookup aliases,
        ITermToRelatedTermsFuzzyLookup fuzzyIndex,
        List<CompiledTermGroup> compiledTerms,
        bool ensureSingleOccurence
    )
    {
        List<SearchTerm> termsNeedingRelated = SelectTermsNeedingRelated(compiledTerms);
        if (termsNeedingRelated.IsNullOrEmpty())
        {
            return;
        }

        List<string> termTexts = termsNeedingRelated.Map((st) => st.Term.Text);
        // First, find an known related terms
        var knownRelatedTerms = await aliases.LookupTermsAsync(
            termTexts,
            _cancellationToken
        ).ConfigureAwait(false);

        if (!knownRelatedTerms.IsNullOrEmpty())
        {
            for (int i = 0; i < termsNeedingRelated.Count;)
            {
                if (knownRelatedTerms.TryGetValue(termTexts[i], out var relatedTerms))
                {
                    termsNeedingRelated[i].RelatedTerms = relatedTerms;
                    termTexts.RemoveAt(i);
                    termsNeedingRelated.RemoveAt(i);
                    continue;
                }
                else
                {
                    ++i;
                }
            }
        }
        // Anything that did not have known related terms... will get terms that are fuzzily related
        if (termsNeedingRelated.IsNullOrEmpty())
        {
            return;
        }
        var relatedTermsFuzzy = await fuzzyIndex.LookupTermsAsync(
            termTexts,
            null,
            null,
            _cancellationToken
        ).ConfigureAwait(false);
        for (int i = 0; i < termsNeedingRelated.Count; ++i)
        {
            termsNeedingRelated[i].RelatedTerms = relatedTermsFuzzy[i];
        }

        //
        // Due to fuzzy matching, a search term may end with related terms that overlap with those of other search terms.
        // This causes scoring problems... duplicate/redundant scoring that can cause items to seem more relevant than they are
        // - The same related term can show up for different search terms but with different weights
        // - related terms may also already be present as search terms
        //
        foreach (var ct in compiledTerms)
        {
            DedupeTermGroup(ct, ensureSingleOccurence && ct.BooleanOp != SearchTermBooleanOp.And);
        }
    }

    // TODO: refactor this logic
    private void DedupeTermGroup(CompiledTermGroup ct, bool ensureSingleOccurrence)
    {
        var searchTerms = ct.Terms;
        TermSet allPrimaryTerms = new TermSet();
        TermSet? allRelatedTerms = ensureSingleOccurrence ? new TermSet() : null;
        //
        // Collect all unique search and related terms.
        // We end up with {term, maximum weight for term} pairs
        //
        foreach (var st in searchTerms)
        {
            allPrimaryTerms.Add(st.Term);
            if (ensureSingleOccurrence && !st.RelatedTerms.IsNullOrEmpty())
            {
                allRelatedTerms!.AddOrUnion(st.RelatedTerms);
            }
        }

        // Related terms may be required by operators such as AND or to enforce scoping rules; removing
        // terms from a term group may cause higher level boolean logic to fail.
        // However, for example with OR operators, a particular related term need match just once in the group..
        foreach (var searchTerm in searchTerms)
        {
            if (searchTerm.RelatedTermsRequired || searchTerm.RelatedTerms.IsNullOrEmpty())
            {
                continue;
            }

            List<Term> uniqueRelatedForSearchTerm = [];
            foreach (var candidateRelatedTerm in searchTerm.RelatedTerms)
            {
                if (allPrimaryTerms.Has(candidateRelatedTerm))
                {
                    // This related term is already a search term
                    continue;
                }
                if (ensureSingleOccurrence && allRelatedTerms is not null && allRelatedTerms.Count > 0)
                {
                    // Each unique related term should be searched for only once
                    // And (if there were duplicates) assign the maximum weight assigned to that term
                    // allRelatedTerms always contains unique terms with the "max weight" - see AddUnion call above
                    Term? termWithMaxWeight = allRelatedTerms.Get(candidateRelatedTerm);
                    if (
                        termWithMaxWeight is not null &&
                        termWithMaxWeight.Weight == candidateRelatedTerm.Weight
                    )
                    {
                        // Associate this related term with the current search term
                        uniqueRelatedForSearchTerm.Add(termWithMaxWeight);
                        allRelatedTerms.Remove(candidateRelatedTerm);
                    }
                    // Else, the max weight term belonged to some other group
                }
                else
                {
                    uniqueRelatedForSearchTerm.Add(candidateRelatedTerm);
                }
            }
            searchTerm.RelatedTerms = uniqueRelatedForSearchTerm;
        }
    }

    private List<SearchTerm>? SelectTermsNeedingRelated(List<Query.CompiledTermGroup> compiledTerms)
    {
        List<SearchTerm> searchTerms = [];
        foreach (var compiledTerm in compiledTerms)
        {
            foreach (var searchTerm in compiledTerm.Terms)
            {
                if (!(searchTerm.IsWildcard() || searchTerm.IsExactMatch()))
                {
                    searchTerms.Add(searchTerm);
                }
            }
        }
        return searchTerms;
    }

    private void ValidateAndPrepare(IList<SearchTerm> searchTerms)
    {
        foreach (var searchTerm in searchTerms)
        {
            ValidateAndPrepare(searchTerm);
        }
    }

    private void ValidateAndPrepare(SearchTerm searchTerm)
    {
        ValidateAndPrepare(searchTerm.Term);

        // Matching the term - exact match - counts for more than matching related terms
        // Therefore, we boost any matches where the term matches directly...
        searchTerm.Term.Weight ??= Settings.DefaultTermMatchWeight;
        if (!searchTerm.RelatedTerms.IsNullOrEmpty())
        {
            foreach (var relatedTerm in searchTerm.RelatedTerms)
            {
                ValidateAndPrepare(relatedTerm);
                // If related term is *really* similar to the main term, score it the same
                if (
                    relatedTerm.Weight is not null &&
                    relatedTerm.Weight.Value >= Settings.RelatedIsExactThreshold
                )
                {
                    relatedTerm.Weight = Settings.DefaultTermMatchWeight;
                }
            }
        }
    }

    /**
     * Currently, just changes the case of a term
     *  But here, we may do other things like:
     * - Check for noise terms
     * - Do additional rewriting
     * - Additional checks that *reject* certain search terms
     * Return false if the term should be rejected
     */
    private void ValidateAndPrepare(Term? term)
    {
        KnowProVerify.ThrowIfInvalid(term);
        term.ToLower();
    }
}
