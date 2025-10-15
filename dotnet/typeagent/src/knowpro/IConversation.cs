// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro;

/// <summary>
/// For IConversation levelAPIs:
/// <see cref="ConversationExtensions"/>
/// </summary>
/// <typeparam name="TMessage"></typeparam>
public interface IConversation<TMessage> : IDisposable
    where TMessage : IMessage
{
    IMessageCollection<TMessage> Messages { get; }

    ISemanticRefCollection SemanticRefs { get; }

    ITermToSemanticRefIndex SemanticRefIndex { get; }

    IConversationSecondaryIndexes SecondaryIndexes { get; }
}


public interface IConversation
{
    IMessageCollection Messages { get; }

    ISemanticRefCollection SemanticRefs { get; }

    ITermToSemanticRefIndex SemanticRefIndex { get; }

    IConversationSecondaryIndexes SecondaryIndexes { get; }
}


public static class ConversationExtensions
{
    public static async ValueTask<IDictionary<KnowledgeType, SemanticRefSearchResult>?> SearchKnowledgeAsync(
        this IConversation conversation,
        SearchTermGroup searchTermGroup,
        WhenFilter? whenFilter = null,
        SearchOptions? options = null,
        CancellationToken cancellationToken = default
    )
    {
        QueryCompiler compiler = new QueryCompiler(conversation);
        options ??= SearchOptions.CreateDefault();

        var queryExpr = await compiler.CompileKnowledgeQueryAsync(
            searchTermGroup,
            whenFilter,
            options
        ).ConfigureAwait(false);

        QueryEvalContext context = new QueryEvalContext(conversation, cancellationToken);
        return await queryExpr.EvalAsync(context).ConfigureAwait(false);
    }

    public static ValueTask<ConversationSearchResult?> SearchConversationAsync(
        this IConversation conversation,
        SearchTermGroup searchTermGroup,
        CancellationToken cancellationToken = default
    )
    {
        return conversation.SearchConversationAsync(searchTermGroup, null, null, null, cancellationToken);
    }

    public static async ValueTask<ConversationSearchResult?> SearchConversationAsync(
        this IConversation conversation,
        SearchTermGroup searchTermGroup,
        WhenFilter? whenFilter = null,
        SearchOptions? options = null,
        string? rawSearchQuery = null,
        CancellationToken cancellationToken = default
    )
    {
        options ??= SearchOptions.CreateDefault();
        QueryCompiler compiler = new QueryCompiler(conversation);

        var knowledgeQueryExpr = await compiler.CompileKnowledgeQueryAsync(
            searchTermGroup,
            whenFilter,
            options
        ).ConfigureAwait(false);

        var messageQueryExpr = await compiler.CompileMessageQueryAsync(
            knowledgeQueryExpr,
            options,
            rawSearchQuery
        ).ConfigureAwait(false);

        QueryEvalContext context = new QueryEvalContext(conversation, cancellationToken);
        var messageOrdinals = await messageQueryExpr.EvalAsync(context).ConfigureAwait(false);
        return new ConversationSearchResult()
        {
            MessageMatches = messageOrdinals,
            KnowledgeMatches = context.KnowledgeMatches,
            RawSearchQuery = rawSearchQuery,
        };
    }

}
