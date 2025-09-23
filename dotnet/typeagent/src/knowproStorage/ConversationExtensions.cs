// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Storage.Local;

namespace TypeAgent.KnowPro.Storage;

public static class ConversationExtensions
{
    public static async Task<int> ImportMessagesAsync<TMessage>(this IConversation<TMessage> conversation, IEnumerable<TMessage> messages, CancellationToken cancellationToken = default)
        where TMessage : IMessage
    {
        await conversation.Messages.AppendAsync(messages, cancellationToken);
        return await conversation.Messages.GetCountAsync(cancellationToken);
    }

    public static async Task<int> ImportSemanticRefsAsync<TMessage>(this IConversation<TMessage> conversation, IEnumerable<SemanticRef> semanticRefs, CancellationToken cancellationToken = default)
        where TMessage : IMessage
    {
        await conversation.SemanticRefs.AppendAsync(semanticRefs, cancellationToken);
        return await conversation.SemanticRefs.GetCountAsync(cancellationToken);
    }

    public static async Task ImportDataAsync<TMessage>(this IConversation<TMessage> conversation, ConversationData<TMessage> data, CancellationToken cancellationToken = default)
        where TMessage : IMessage
    {
        await conversation.ImportMessagesAsync(data.Messages, cancellationToken);
        await conversation.ImportSemanticRefsAsync(data.SemanticRefs, cancellationToken);
    }
}
