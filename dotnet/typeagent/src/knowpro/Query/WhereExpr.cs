// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Query;

internal class WhereExpr : QueryOpExpr<SemanticRefAccumulator>
{
    KnowledgeType KnowledgeType{ get; }

    public WhereExpr(QueryOpExpr<SemanticRefAccumulator> matches, KnowledgeType knowledgeType)
    {
        ArgumentVerify.ThrowIfNull(matches, nameof(matches));
        Matches = matches;
        KnowledgeType = knowledgeType;
    }

    public QueryOpExpr<SemanticRefAccumulator> Matches { get; }

    public override async ValueTask<SemanticRefAccumulator> EvalAsync(QueryEvalContext context)
    {
        // Get the matches from the inner expression
        SemanticRefAccumulator semanticRefMatches = await Matches.EvalAsync(context).ConfigureAwait(false);

        // Extract the ordinals to look up
        List<ScoredSemanticRefOrdinal> refs = [];
        foreach (Match<int> m in semanticRefMatches.GetMatches())
        {
            refs.Add(new ScoredSemanticRefOrdinal() { Score = m.Score, SemanticRefOrdinal = m.Value });
        }

        // Look up all semantic refs of the specified knowledge type
        IList<ScoredSemanticRefOrdinal> entityRefs = await LookupExtensions.FilterAsync(context, refs, (SemanticRef sr, ScoredSemanticRefOrdinal sso) =>
        {
            return sr.KnowledgeType == this.KnowledgeType;
        });

        // make a hashet of the ordinals for fast lookup
        HashSet<int> ids = [];
        foreach (ScoredSemanticRefOrdinal scoredOrdinal in entityRefs)
        {
            ids.Add(scoredOrdinal.SemanticRefOrdinal);
        }

        // filter the original matches to only those in the set
        SemanticRefAccumulator results = new();
        foreach (var item in semanticRefMatches.GetMatches())
        {
            if (ids.Contains(item.Value))
            {
                results.Add(item.Value, item.Score, true);
            }
        }

        return results;
    }
}
