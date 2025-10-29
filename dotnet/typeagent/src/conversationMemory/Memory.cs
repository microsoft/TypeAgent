// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public class Memory<TMessage> : Conversation<TMessage>
    where TMessage : class, IMessage, new()
{

    public Memory(ConversationSettings settings, IStorageProvider<TMessage> storageProvider)
        : base(settings, storageProvider)
    {

    }

    public string Name { get; set; }

    public IList<string> Tags { get; set; }
}
