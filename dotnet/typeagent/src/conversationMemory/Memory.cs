// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public class Memory<TMessage> : Conversation<TMessage>
    where TMessage : class, IMessage, new()
{

    public Memory(MemorySettings settings, IStorageProvider<TMessage> storageProvider)
        : base(settings.ConversationSettings, storageProvider)
    {
        Settings = settings;
    }

    public new MemorySettings Settings { get; }

    public string Name { get; set; }

    public IList<string> Tags { get; set; }
}
