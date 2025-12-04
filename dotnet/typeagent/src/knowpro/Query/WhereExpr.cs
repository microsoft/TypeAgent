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
        SemanticRefAccumulator semanticRefMatches = await Matches.EvalAsync(context).ConfigureAwait(false);

        int index = 0;
        while (index < semanticRefMatches.Count)
        {
            context.CancellationToken.ThrowIfCancellationRequested();
            index++;
        }

        return semanticRefMatches;
    }
}
