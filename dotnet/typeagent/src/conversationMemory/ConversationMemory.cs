// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.ConversationMemory;

public class ConversationMemory<TMessage> : Conversation<TMessage>
    where TMessage : IMessage, new()
{
    public ConversationMemory(ConversationSettings settings, IStorageProvider<TMessage> provider)
        : base(settings, provider)
    {
    }
}
