// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.ConversationMemory;

public class Memory<TMessage> : IConversation<TMessage>
    where TMessage : IMessage, new()
{
    IStorageProvider<TMessage> _storageProvider;
    IMessageCollection<TMessage> _messages;
    ISemanticRefCollection _semanticRefs;

    public Memory(IStorageProvider<TMessage> provider)
        : this(provider.Messages, provider.SemanticRefs)
    {
        _storageProvider = provider;
    }

    public Memory(
        IMessageCollection<TMessage> messages,
        ISemanticRefCollection semanticRefs
    )
    {
        ArgumentNullException.ThrowIfNull(messages, nameof(messages));
        ArgumentNullException.ThrowIfNull(semanticRefs, nameof(semanticRefs));
        _messages = messages;
        _semanticRefs = semanticRefs;
    }

    public string Name { get; set; }

    public IList<string> Tags { get; set; }

    public IMessageCollection<TMessage> Messages => _messages;

    public ISemanticRefCollection SemanticRefs => _semanticRefs;

    public ITermToSemanticRefIndex SemanticRefIndex => throw new NotImplementedException();

    public IConversationSecondaryIndexes SecondaryIndexes => throw new NotImplementedException();
}
