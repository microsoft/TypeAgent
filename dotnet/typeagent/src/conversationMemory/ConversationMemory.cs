// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.ConversationMemory;

public class ConversationMemory<TMessage> : Conversation<TMessage>
    where TMessage : IMessage, new()
{
    public ConversationMemory(IStorageProvider<TMessage> provider)
        : base(provider)
    {
    }
}
