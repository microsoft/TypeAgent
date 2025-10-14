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

        var query = await compiler.CompileKnowledgeQueryAsync(
            searchTermGroup,
            whenFilter,
            options
        ).ConfigureAwait(false);

        var result = await conversation.RunQueryAsync(query, cancellationToken).ConfigureAwait(false);
        return result;
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

        var knowledgeQuery = await compiler.CompileKnowledgeQueryAsync(
            searchTermGroup,
            whenFilter,
            options
        ).ConfigureAwait(false);

        var messageQuery = await compiler.CompileMessageQuery(knowledgeQuery).ConfigureAwait(false);
        return null;
    }
}
