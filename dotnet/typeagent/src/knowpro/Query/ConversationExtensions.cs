// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal static class ConversationExtensions
{
    public static ValueTask<T> RunQueryAsync<T>(
        this IConversation conversation,
        QueryOpExpr<T> queryExpr,
        CancellationToken cancellationToken = default
    )
    {
        QueryEvalContext context = new QueryEvalContext(conversation, cancellationToken);
        return queryExpr.EvalAsync(context);
    }
}
