// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro;

public static class ConversationSearch
{
    // TODO: Handle cancellation in these APIS

    public static async ValueTask<IDictionary<KnowledgeType, SemanticRefSearchResult>?> SearchKnowledgeAsync(
        this IConversation conversation,
        SearchSelectExpr select,
        SearchOptions? options,
        IConversationCache? conversationCache = null,
        CancellationToken cancellationToken = default
    )
    {
        QueryEvalContext context = new QueryEvalContext(conversation, conversationCache, cancellationToken);
        QueryCompiler compiler = new QueryCompiler(
            conversation,
            context.Cache,
            conversation.Settings.QueryCompilerSettings,
            cancellationToken
        );
        options ??= SearchOptions.CreateDefault();

        var queryExpr = await compiler.CompileKnowledgeQueryAsync(
            select.SearchTermGroup,
            select.When,
            options
        ).ConfigureAwait(false);

        return await queryExpr.EvalAsync(context).ConfigureAwait(false);
    }

    public static ValueTask<ConversationSearchResult?> SearchConversationAsync(
        this IConversation conversation,
        SearchSelectExpr select,
        SearchOptions? options = null,
        CancellationToken cancellationToken = default
    )
    {
        return conversation.SearchConversationAsync(select, options, null, null, cancellationToken);
    }

    public static async ValueTask<ConversationSearchResult?> SearchConversationAsync(
        this IConversation conversation,
        SearchSelectExpr select,
        SearchOptions? options = null,
        IConversationCache? conversationCache = null,
        string? rawSearchQuery = null,
        CancellationToken cancellationToken = default
    )
    {
        QueryEvalContext context = new QueryEvalContext(conversation, conversationCache, cancellationToken);
        QueryCompiler compiler = new QueryCompiler(
            conversation,
            context.Cache,
            conversation.Settings.QueryCompilerSettings,
            cancellationToken
        );
        options ??= SearchOptions.CreateDefault();

        var knowledgeQueryExpr = await compiler.CompileKnowledgeQueryAsync(
            select.SearchTermGroup,
            select.When,
            options
        ).ConfigureAwait(false);

        var messageQueryExpr = await compiler.CompileMessageQueryAsync(
            knowledgeQueryExpr,
            options,
            rawSearchQuery
        ).ConfigureAwait(false);

        var messageOrdinals = await messageQueryExpr.EvalAsync(context).ConfigureAwait(false);
        return new ConversationSearchResult()
        {
            MessageMatches = messageOrdinals,
            KnowledgeMatches = context.KnowledgeMatches,
            RawSearchQuery = rawSearchQuery,
        };
    }

}
