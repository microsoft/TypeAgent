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
        SearchSelectExpr select,
        SearchOptions? options,
        IConversationCache? cache = null,
        CancellationToken cancellationToken = default
    )
    {
        QueryCompiler compiler = new QueryCompiler(conversation);
        options ??= SearchOptions.CreateDefault();

        var queryExpr = await compiler.CompileKnowledgeQueryAsync(
            select.SearchTermGroup,
            select.When,
            options
        ).ConfigureAwait(false);

        QueryEvalContext context = new QueryEvalContext(conversation, cache, cancellationToken);
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
        options ??= SearchOptions.CreateDefault();
        QueryCompiler compiler = new QueryCompiler(conversation);

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

        QueryEvalContext context = new QueryEvalContext(conversation, conversationCache, cancellationToken);
        var messageOrdinals = await messageQueryExpr.EvalAsync(context).ConfigureAwait(false);
        return new ConversationSearchResult()
        {
            MessageMatches = messageOrdinals,
            KnowledgeMatches = context.KnowledgeMatches,
            RawSearchQuery = rawSearchQuery,
        };
    }

    public static async ValueTask<DateRange?> GetDateRangeAsync(this IConversation conversation)
    {
        var timestampRange = await conversation.GetStartTimestampRangeAsync().ConfigureAwait(false);
        return timestampRange is not null ? new DateRange(timestampRange.Value) : null;
    }

    public static async ValueTask<TimestampRange?> GetStartTimestampRangeAsync(this IConversation conversation)
    {
        // TODO: lower this method the collection

        var messageCount = await conversation.Messages.GetCountAsync();
        if (messageCount > 0)
        {
            var start = await conversation.Messages.GetMessageTimestampAsync(1).ConfigureAwait(false);
            var end = await conversation.Messages.GetMessageTimestampAsync(messageCount - 1).ConfigureAwait(false);
            if (start is not null)
            {
                return new TimestampRange
                {
                    StartTimestamp = start,
                    EndTimestamp = end
                };
            }
        }
        return null;
    }

}
