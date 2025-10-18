// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Query;

internal class GroupByKnowledgeTypeExpr : QueryOpExpr<IDictionary<KnowledgeType, SemanticRefAccumulator>>
{
    public GroupByKnowledgeTypeExpr(QueryOpExpr<SemanticRefAccumulator> matches)
    {
        ArgumentVerify.ThrowIfNull(matches, nameof(matches));
        Matches = matches;
    }

    public QueryOpExpr<SemanticRefAccumulator> Matches { get; }

    public override async ValueTask<IDictionary<KnowledgeType, SemanticRefAccumulator>> EvalAsync(QueryEvalContext context)
    {
        SemanticRefAccumulator semanticRefMatches = await Matches.EvalAsync(context).ConfigureAwait(false);

        var groups = new Dictionary<KnowledgeType, SemanticRefAccumulator>();
        //
        // TODO: parallelize
        //
        foreach (var match in semanticRefMatches.GetMatches())
        {
            // TODO: SemanticRefs are cached during processing.
            // But we could also just get knowledgeTypes directly from the storage provider
            var semanticRef = await context.SemanticRefs.GetAsync(match.Value);
            var group = groups.GetValueOrDefault(semanticRef.KnowledgeType);
            if (group is null)
            {
                group = new SemanticRefAccumulator();
                group.SearchTermMatches = semanticRefMatches.SearchTermMatches;
                groups[semanticRef.KnowledgeType] = group;
            }
            group.SetMatch(match);
        }
        return groups;
    }
}

internal class SelectTopNKnowledgeGroupExpr : QueryOpExpr<IDictionary<KnowledgeType, SemanticRefAccumulator>>
{
    public SelectTopNKnowledgeGroupExpr(QueryOpExpr<IDictionary<KnowledgeType, SemanticRefAccumulator>> srcExpr,
        int maxMatches = -1,
        int minHitCount = -1
    )
    {
        ArgumentVerify.ThrowIfNull(srcExpr, nameof(srcExpr));

        SrcExpr = srcExpr;
        MaxMatches = maxMatches;
        MinHitCount = minHitCount;
    }

    public int MaxMatches { get; }
    public int MinHitCount { get; }
    public QueryOpExpr<IDictionary<KnowledgeType, SemanticRefAccumulator>> SrcExpr { get; }

    public override async ValueTask<IDictionary<KnowledgeType, SemanticRefAccumulator>> EvalAsync(QueryEvalContext context)
    {
        var groupsAccumulators = await SrcExpr.EvalAsync(context).ConfigureAwait(false);
        foreach (var group in groupsAccumulators.Values)
        {
            group.SelectTopNScoring(MaxMatches, MinHitCount);
        }
        return groupsAccumulators;
    }
}


internal class GroupSearchResultsExpr : QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>>
{
    public GroupSearchResultsExpr(QueryOpExpr<IDictionary<KnowledgeType, SemanticRefAccumulator>> srcExpr)
    {
        ArgumentVerify.ThrowIfNull(srcExpr, nameof(srcExpr));
        SrcExpr = srcExpr;
    }

    public QueryOpExpr<IDictionary<KnowledgeType, SemanticRefAccumulator>> SrcExpr { get; }

    public override async ValueTask<IDictionary<KnowledgeType, SemanticRefSearchResult>> EvalAsync(QueryEvalContext context)
    {
        var evalResults = await SrcExpr.EvalAsync(context).ConfigureAwait(false);

        var semanticRefMatches = new Dictionary<KnowledgeType, SemanticRefSearchResult>();
        foreach (var kv in evalResults)
        {
            var accumulator = kv.Value;
            if (accumulator.Count > 0)
            {
                semanticRefMatches.Add(
                    kv.Key,
                    new SemanticRefSearchResult()
                    {
                        TermMatches = accumulator.SearchTermMatches,
                        SemanticRefMatches = accumulator.ToScoredOrdinals(),
                    }
                );
            }
        }

        return semanticRefMatches;
    }
}
