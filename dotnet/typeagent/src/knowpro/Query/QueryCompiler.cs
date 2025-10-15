// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading.Tasks;

namespace TypeAgent.KnowPro.Query;

internal class QueryCompiler
{
    private IConversation _conversation;
    private List<SearchTermGroup> _allSearchTerms;

    public QueryCompiler(IConversation conversation)
    {
        _conversation = conversation;
        _allSearchTerms = [];
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

    public (IList<SearchTermGroup>, QueryOpExpr<SemanticRefAccumulator>) CompileSearchGroup(
        SearchTermGroup searchGroup,
        GetScopeExpr? scopeExpr,
        IQuerySemanticRefPredicate? matchFilter = null
    )
    {
        List<SearchTermGroup> compiledTerms = [new SearchTermGroup(searchGroup.BooleanOp)];

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
                    var (nestedTerms, groupExpr) = CompileSearchGroup(
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

    public (IList<SearchTermGroup>, QueryOpExpr<MessageAccumulator>) CompileMessageSearchGroup(
       SearchTermGroup searchGroup,
       IQuerySemanticRefPredicate? matchFilter = null
   )
    {
        List<SearchTermGroup> compiledTerms = [new SearchTermGroup(searchGroup.BooleanOp)];

        List<QueryOpExpr> termExpressions = [];
        foreach (var term in searchGroup.Terms)
        {
            switch (term)
            {
                default:
                    break;

                case PropertySearchTerm propertyTerm:
                    // FIX: Cast propertyExpr to QueryOpExpr<IMessageOrdinalSource?>
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
                    // FIX: Cast groupExpr to QueryOpExpr<IMessageOrdinalSource?>
                    var (nestedTerms, groupExpr) = CompileSearchGroup(
                        subGroup,
                        null,  // Apply scopes on the outermost expression only
                        matchFilter
                    );
                    compiledTerms.AddRange(nestedTerms);
                    termExpressions.Add(groupExpr);
                    break;

                case SearchTerm searchTerm:
                    // FIX: Cast searchTermExpr to QueryOpExpr<IMessageOrdinalSource?>
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
        var scopeExpr = await CompileScope(searchGroup, whenFilter).ConfigureAwait(false);

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
        var (searchTermsUsed, selectExpr) = CompileSearchGroup(searchGroup, scopeExpr);
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
                    if (propertyTerm.isEntityPropertyTerm())
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

    private ValueTask<GetScopeExpr?> CompileScope(SearchTermGroup? termGroup, WhenFilter? filter)
    {
        // TODO
        return ValueTask.FromResult<GetScopeExpr>(null);
    }
}
