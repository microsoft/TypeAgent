// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro;

public static class ConversationAPI
{
    public static async Task<IDictionary<KnowledgeType, SemanticRefSearchResult>?> SearchKnowledgeAsync(
        this IConversation conversation,
        SearchTermGroup searchGroup,
        WhenFilter? whenFilter = null,
        SearchOptions? options = null,
        CancellationToken cancellationToken = default
    )
    {
        QueryCompiler compiler = new QueryCompiler(conversation);
        var query = await compiler.CompileKnowledgeQueryAsync(searchGroup, whenFilter, options);
        await conversation.RunQueryAsync<object>(query, cancellationToken);
        return null;
    }


    private static ValueTask<T> RunQueryAsync<T>(
        this IConversation conversation,
        QueryOpExpr<T> queryExpr,
        CancellationToken cancellationToken = default
    )
    {
        QueryEvalContext context = new QueryEvalContext(conversation, cancellationToken);
        return queryExpr.EvalAsync(context);
    }
}
