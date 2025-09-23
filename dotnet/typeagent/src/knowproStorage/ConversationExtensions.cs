// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage;

public static class ConversationExtensions
{
    public static Task ImportMessagesAsync<TMessage>(this IConversation<TMessage> conversation, IEnumerable<TMessage> messages, CancellationToken cancellationToken = default)
        where TMessage : IMessage
    {
        return conversation.Messages.AppendAsync(messages, cancellationToken);
    }

    public static Task ImportSemanticRefsAsync<TMessage>(this IConversation<TMessage> conversation, IEnumerable<SemanticRef> semanticRefs)
        where TMessage : IMessage
    {
        return conversation.SemanticRefs.AppendAsync(semanticRefs);
    }
}
