// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Storage.Local;

namespace TypeAgent.KnowPro.Storage;

public static class ImportExtensions
{
    public static async Task<int> ImportMessagesAsync<TMessage>(this IConversation<TMessage> conversation, IEnumerable<TMessage> messages, CancellationToken cancellationToken = default)
        where TMessage : IMessage
    {
        if (messages is null)
        {
            return 0;
        }
        await conversation.Messages.AppendAsync(messages, cancellationToken).ConfigureAwait(false);
        return await conversation.Messages.GetCountAsync(cancellationToken).ConfigureAwait(false);
    }

    public static async Task<int> ImportSemanticRefsAsync<TMessage>(this IConversation<TMessage> conversation, IEnumerable<SemanticRef> semanticRefs, CancellationToken cancellationToken = default)
        where TMessage : IMessage
    {
        if (semanticRefs is null)
        {
            return 0;
        }
        await conversation.SemanticRefs.AppendAsync(semanticRefs, cancellationToken).ConfigureAwait(false);
        return await conversation.SemanticRefs.GetCountAsync(cancellationToken).ConfigureAwait(false);
    }

    public static async Task ImportTermToSemanticRefIndexAsync<TMessage>(this IConversation<TMessage> conversation, IEnumerable<TermToSemanticRefIndexDataItem> indexItems, CancellationToken cancellationToken = default)
        where TMessage : IMessage
    {
        if (indexItems is null)
        {
            return;
        }

        foreach (var indexItem in indexItems)
        {
            if (!indexItem.SemanticRefOrdinals.IsNullOrEmpty())
            {
                await conversation.SemanticRefIndex.AddEntriesAsync(indexItem.Term, indexItem.SemanticRefOrdinals, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    public static async Task ImportDataAsync<TMessage>(this IConversation<TMessage> conversation, ConversationData<TMessage> data, CancellationToken cancellationToken = default)
        where TMessage : IMessage
    {
        if (!data.Messages.IsNullOrEmpty())
        {
            await conversation.ImportMessagesAsync(data.Messages, cancellationToken).ConfigureAwait(false);
        }
        if (!data.SemanticRefs.IsNullOrEmpty())
        {
            await conversation.ImportSemanticRefsAsync(data.SemanticRefs, cancellationToken).ConfigureAwait(false);
        }
        if (data.SemanticIndexData is not null)
        {
            await conversation.ImportTermToSemanticRefIndexAsync(data.SemanticIndexData.Items, cancellationToken).ConfigureAwait(false);
        }
    }
}
