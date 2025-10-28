// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading.Tasks;

namespace TypeAgent.KnowPro.Query;

internal class QueryCompiler
{
    private IConversation _conversation;
    private List<CompiledTermGroup> _allSearchTerms;
    private List<CompiledTermGroup> _allScopeSearchTerms;
    private CancellationToken _cancellationToken;

    public QueryCompiler(IConversation conversation, CancellationToken cancellationToken = default)
    {
        _conversation = conversation;
        _allSearchTerms = [];
        _allScopeSearchTerms = [];
    }

    public float EntityTermMatchWeight { get; set; } = 100;

    public float DefaultTermMatchWeight { get; set; } = 10;

    public double RelatedIsExactThreshold { get; set; } = 0.95;

    public async ValueTask<QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>>> CompileKnowledgeQueryAsync(
        SearchTermGroup searchGroup,
        WhenFilter? whenFilter,
        SearchOptions? searchOptions
    )
    {
        var queryExpr = await CompileQueryAsync(searchGroup, whenFilter).ConfigureAwait(false);
        QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>> resultExpr = new GroupSearchResultsExpr(queryExpr);
        return resultExpr;
    }

    public ValueTask<QueryOpExpr<List<ScoredMessageOrdinal>>> CompileMessageQueryAsync(
        QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>> knowledgeMatches,
        SearchOptions? options,
        string? rawSearchQuery
    )
    {
        QueryOpExpr<MessageAccumulator> query = new MessagesFromKnowledgeExpr(knowledgeMatches);
        if (options is not null)
        {
            if (options.MaxCharsInBudget is not null && options.MaxCharsInBudget.Value > 0)
            {
                query = new SelectMessagesInCharBudget(query, options.MaxCharsInBudget.Value);
            }
        }

        QueryOpExpr<List<ScoredMessageOrdinal>> messagesExpr = new GetScoredMessagesExpr(query);
        return ValueTask.FromResult(messagesExpr);
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
        float boostWeight =
            EntityTermMatchWeight / DefaultTermMatchWeight;

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
                        propertyTerm.PropertyValue.Term.Weight ??= EntityTermMatchWeight;
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
                var tagGroup = new SearchTermGroup(SearchTermBooleanOp.OrMax);
                tagGroup.Add(KnowledgePropertyName.Tag, filter.Tags, true);
                AddTermsScopeSelector(tagGroup, scopeSelectors);
            }

            if (!filter.TagMatchingTerms.IsNullOrEmpty())
            {
                AddTermsScopeSelector(termGroup, scopeSelectors, new KnowledgeTypePredicate(KnowledgeType.STag));
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
        bool ensureSingleOccurence
    )
    {
        ITermToRelatedTermIndex relatedTermIndex = _conversation.SecondaryIndexes.TermToRelatedTermsIndex;

        List<SearchTerm> termsNeedingRelated = SelectTermsNeedingRelated(compiledTerms);
        if (termsNeedingRelated.IsNullOrEmpty())
        {
            return;
        }

        List<string> termTexts = termsNeedingRelated.Map((st) => st.Term.Text);
        // First, find an known related terms
        var knownRelatedTerms = await relatedTermIndex.Aliases.LookupTermAsync(termTexts, _cancellationToken).ConfigureAwait(false);
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
        var relatedTermsFuzzy = await relatedTermIndex.FuzzyIndex.LookupTermAsync(termTexts);
        for (int i = 0; i < termsNeedingRelated.Count; ++i)
        {
            termsNeedingRelated[i].RelatedTerms = relatedTermsFuzzy[i];
        }
    }

    private List<SearchTerm>? SelectTermsNeedingRelated(List<CompiledTermGroup> compiledTerms)
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
}
