// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.ConversationMemory;

public class Memory<TMessage> : IConversation<TMessage>
    where TMessage : IMessage, new()
{
    IStorageProvider<TMessage> _storageProvider;
    IMessageCollection<TMessage> _messages;
    ISemanticRefCollection _semanticRefs;
    ITermToSemanticRefIndex _semanticRefIndex;

    public Memory(IStorageProvider<TMessage> provider)
        : this(
              provider.Messages,
              provider.SemanticRefs,
              provider.SemanticRefIndex
          )
    {
        _storageProvider = provider;
    }

    public Memory(
        IMessageCollection<TMessage> messages,
        ISemanticRefCollection semanticRefs,
        ITermToSemanticRefIndex semanticRefIndex
    )
    {
        ArgumentNullException.ThrowIfNull(messages, nameof(messages));
        ArgumentNullException.ThrowIfNull(semanticRefs, nameof(semanticRefs));
        ArgumentNullException.ThrowIfNull(semanticRefIndex, nameof(semanticRefIndex));

        _messages = messages;
        _semanticRefs = semanticRefs;
        _semanticRefIndex = semanticRefIndex;
    }

    public string Name { get; set; }

    public IList<string> Tags { get; set; }

    public IMessageCollection<TMessage> Messages => _messages;

    public ISemanticRefCollection SemanticRefs => _semanticRefs;

    public ITermToSemanticRefIndex SemanticRefIndex => _semanticRefIndex;

    public IConversationSecondaryIndexes SecondaryIndexes => throw new NotImplementedException();
}
