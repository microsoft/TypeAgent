// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.ConversationMemory;

public class Memory<TMessage> : IConversation<TMessage>
    where TMessage : IMessage, new()
{
    IStorageProvider<TMessage> _storageProvider;
    IMessageCollection<TMessage> _messages;

    public Memory(IStorageProvider<TMessage> provider)
    {
        _storageProvider = provider;
        _messages = provider.Messages;
    }

    public string Name { get; set; }

    public IList<string> Tags { get; set; }

    public IMessageCollection<TMessage> Messages => _messages;

    public ISemanticRefCollection SemanticRefs => throw new NotImplementedException();

    public ITermToSemanticRefIndex SemanticRefIndex => throw new NotImplementedException();

    public IConversationSecondaryIndexes SecondaryIndexes => throw new NotImplementedException();
}
