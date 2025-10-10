// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Threading.Tasks;

namespace TypeAgent.KnowPro.Query;

internal class QueryCompiler
{
    private IConversation _conversation;
    private List<CompiledTermGroup> _allSearchTerms;

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
        var queryExpr = await CompileQueryAsync(searchGroup, whenFilter);
        QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>> resultExpr = new GroupSearchResultsExpr(queryExpr);
        return resultExpr;
    }

    public (IList<CompiledTermGroup>, QueryOpExpr<SemanticRefAccumulator>) CompileSearchTermGroup(
        SearchTermGroup searchGroup,
        GetScopeExpr? scopeExpr
    )
    {
        IList<CompiledTermGroup> compiledTerms = [new CompiledTermGroup(searchGroup.BooleanOp)];

        IList<QueryOpExpr<SemanticRefAccumulator?>> termExpressions = [];
        foreach (var term in searchGroup.Terms)
        {
            switch (term)
            {
                default:
                    break;

                case SearchTerm searchTerm:
                    var searchTermExpr = CompileSearchTerm(searchTerm);
                    termExpressions.Add(searchTermExpr);
                    break;

                case SearchTermGroup subGroup:
                    break;
            }
        }

        var boolExpr = MatchTermsBooleanExpr.CreateMatchTermsBooleanExpr(
            termExpressions,
            searchGroup.BooleanOp,
            scopeExpr
        );
        return (compiledTerms, boolExpr);
    }

    private async Task<QueryOpExpr<IDictionary<KnowledgeType, SemanticRefAccumulator>>> CompileQueryAsync(
        SearchTermGroup searchGroup,
        WhenFilter? whenFilter
    )
    {
        var scopeExpr = await CompileScope(searchGroup, whenFilter);
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
        var (searchTermsUsed, selectExpr) = CompileSearchTermGroup(searchGroup, scopeExpr);
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
        throw new NotImplementedException();
    }

    private ValueTask<GetScopeExpr?> CompileScope(SearchTermGroup? termGroup, WhenFilter? filter)
    {
        // TODO
        return ValueTask.FromResult<GetScopeExpr>(null);
    }
}
