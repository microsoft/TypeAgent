// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class QueryCompiler
{
    private IConversation _conversation;

    public QueryCompiler(IConversation conversation)
    {
        _conversation = conversation;
    }

    public float EntityTermMatchWeight { get; set; } = 100;

    public float DefaultTermMatchWeight { get; set; } = 10;

    public double RelatedIsExactThreshold { get; set; } = 0.95;

    public ValueTask<QueryOpExpr> CompileKnowledgeQueryAsync(SearchTermGroup searchGroup, WhenFilter? whenFilter)
    {
        var query = CompileQuery(searchGroup, whenFilter);
        return ValueTask.FromResult(query);
    }

    public (IList<CompiledTermGroup>, QueryOpExpr) CompileSearchTermGroup(SearchTermGroup searchGroup)
    {
        IList<CompiledTermGroup> compiledTerms = [new CompiledTermGroup(searchGroup.BooleanOp)];

        IList<QueryOpExpr> termExpressions = [];
        foreach (var term in searchGroup.Terms)
        {
            switch(term)
            {
                default:
                    break;

                case SearchTerm searchTerm:
                    break;

                case SearchTermGroup subGroup:
                    break;
            }
        }

        return (compiledTerms, null);
    }

    private QueryOpExpr CompileQuery(SearchTermGroup searchGroup, WhenFilter? whenFilter)
    {
        return null;
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
