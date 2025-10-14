// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Query;

internal class MessagesFromKnowledgeExpr : QueryOpExpr<MessageAccumulator>
{
    internal MessagesFromKnowledgeExpr(
        QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>> srcExpr
    )
    {
        ArgumentVerify.ThrowIfNull(srcExpr, nameof(srcExpr));
        SrcExpr = srcExpr;
    }

    public QueryOpExpr<IDictionary<KnowledgeType, SemanticRefSearchResult>> SrcExpr { get; }

    public override async ValueTask<MessageAccumulator> EvalAsync(QueryEvalContext context)
    {
        var knowledgeResults = await SrcExpr.EvalAsync(context);
        var messages = new MessageAccumulator();
        if (!knowledgeResults.IsNullOrEmpty())
        {
        }
        return messages;
    }
}
