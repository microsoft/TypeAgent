// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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

    public ValueTask<QueryOpExpr<SemanticRefAccumulator>> CompileKnowledgeQueryAsync(
        SearchTermGroup searchGroup,
        WhenFilter? whenFilter,
        SearchOptions? searchOptions
    )
    {
        var query = CompileQuery(searchGroup, whenFilter);
        return ValueTask.FromResult(query);
    }

    public (IList<CompiledTermGroup>, QueryOpExpr<SemanticRefAccumulator>) CompileSearchTermGroup(SearchTermGroup searchGroup)
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

        var boolExpr = MatchTermsBooleanExpr.CreateMatchTermsBooleanExpr(termExpressions, searchGroup.BooleanOp);
        return (compiledTerms, boolExpr);
    }

    private QueryOpExpr<SemanticRefAccumulator> CompileQuery(SearchTermGroup searchGroup, WhenFilter? whenFilter)
    {
        return CompileSelect(searchGroup);
    }

    private QueryOpExpr<SemanticRefAccumulator> CompileSelect(SearchTermGroup searchGroup)
    {
        var (searchTermsUsed, selectExpr) = CompileSearchTermGroup(searchGroup);
        _allSearchTerms.AddRange(searchTermsUsed);
        return selectExpr;
    }

    private QueryOpExpr<SemanticRefAccumulator?> CompileSearchTerm(SearchTerm searchTerm)
    {
        float boostWeight =
            EntityTermMatchWeight / DefaultTermMatchWeight;

        return new MatchSearchTermExpr(
            searchTerm,
            (term, semanticRef, scoredOrdinal) =>
        {
            return Ranker.BoostEntities(semanticRef, scoredOrdinal, boostWeight);
        });
    }

    private QueryOpExpr<SemanticRefAccumulator?> CompilePropertyTerm(PropertySearchTerm propertyTerm)
    {
        throw new NotImplementedException();
    }
}
