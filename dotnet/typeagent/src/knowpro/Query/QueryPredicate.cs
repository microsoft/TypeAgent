// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal interface IQuerySemanticRefPredicate
{
    bool Eval(QueryEvalContext context, SemanticRef semanticRef);
}

internal class KnowledgeTypePredicate : IQuerySemanticRefPredicate
{
    public KnowledgeTypePredicate(KnowledgeType type)
    {
        Type = type;
    }

    public KnowledgeType Type { get; }

    public bool Eval(QueryEvalContext context, SemanticRef semanticRef)
    {
        return semanticRef.KnowledgeType == Type;
    }
}

internal class FilterMatchTermExpr : QueryOpExpr<SemanticRefAccumulator?>
{
    public FilterMatchTermExpr(
        QueryOpExpr<SemanticRefAccumulator?> sourceExpr,
        IQuerySemanticRefPredicate filter
    )
        : base()
    {
        ArgumentVerify.ThrowIfNull(sourceExpr, nameof(sourceExpr));
        ArgumentVerify.ThrowIfNull(filter, nameof(filter));

        SourceExpr = sourceExpr;
        Filter = filter;
    }

    public QueryOpExpr<SemanticRefAccumulator?> SourceExpr { get; }
    public IQuerySemanticRefPredicate Filter { get; }

    public override async ValueTask<SemanticRefAccumulator?> EvalAsync(QueryEvalContext context)
    {
        var accumulator = await SourceExpr.EvalAsync(context).ConfigureAwait(false);
        if (accumulator is null || accumulator.Count == 0)
        {
            return accumulator;
        }
        var semanticRefs = await context.SemanticRefs.GetAsync(accumulator.ToOrdinals()).ConfigureAwait(false);

        var filtered = new SemanticRefAccumulator(accumulator.SearchTermMatches);
        int i = 0;
        foreach (var match in accumulator.GetMatches())
        {
            if (Filter.Eval(context, semanticRefs[i]))
            {
                filtered.SetMatch(match);
            }
            ++i;
        }
        return filtered;
    }
}
