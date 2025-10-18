// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public class Memory<TMessage> : Conversation<TMessage>
    where TMessage : class, IMessage, new()
{

    public Memory(IStorageProvider<TMessage> storageProvider)
        : base(storageProvider)
    {

    }

    public string Name { get; set; }

    public IList<string> Tags { get; set; }
}
