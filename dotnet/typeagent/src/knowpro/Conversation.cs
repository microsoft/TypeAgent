// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class Conversation<TMessage> : IConversation<TMessage>
    where TMessage : IMessage, new()
{
    IStorageProvider<TMessage> _storageProvider;
    IMessageCollection<TMessage> _messages;
    ISemanticRefCollection _semanticRefs;
    ITermToSemanticRefIndex _semanticRefIndex;
    IConversationSecondaryIndexes _secondaryIndexes;

    public Conversation(IStorageProvider<TMessage> provider)
        : this(
              provider.Messages,
              provider.SemanticRefs,
              provider.SemanticRefIndex,
              provider.Secondaryindexes
          )
    {
        _storageProvider = provider;
    }

    public Conversation(
        IMessageCollection<TMessage> messages,
        ISemanticRefCollection semanticRefs,
        ITermToSemanticRefIndex semanticRefIndex,
        IConversationSecondaryIndexes secondaryIndexes
    )
    {
        ArgumentNullException.ThrowIfNull(messages, nameof(messages));
        ArgumentNullException.ThrowIfNull(semanticRefs, nameof(semanticRefs));
        ArgumentNullException.ThrowIfNull(semanticRefIndex, nameof(semanticRefIndex));
        ArgumentNullException.ThrowIfNull(secondaryIndexes, nameof(secondaryIndexes));

        _messages = messages;
        _semanticRefs = semanticRefs;
        _semanticRefIndex = semanticRefIndex;
        _secondaryIndexes = secondaryIndexes;
    }

    public string Name { get; set; }

    public IList<string> Tags { get; set; }

    public IMessageCollection<TMessage> Messages => _messages;

    public ISemanticRefCollection SemanticRefs => _semanticRefs;

    public ITermToSemanticRefIndex SemanticRefIndex => _semanticRefIndex;

    public IConversationSecondaryIndexes SecondaryIndexes => _secondaryIndexes;
}

public class ConversationSecondaryIndexes : IConversationSecondaryIndexes
{
    IPropertyToSemanticRefIndex _propertyIndex;

    public ConversationSecondaryIndexes(IPropertyToSemanticRefIndex propertyIndex)
    {
        ArgumentVerify.ThrowIfNull(propertyIndex, nameof(propertyIndex));

        _propertyIndex = propertyIndex;
    }

    public IPropertyToSemanticRefIndex PropertyToSemanticRefIndex => _propertyIndex;

    public ITermToRelatedTermIndex TermToRelatedTermsIndex => throw new NotImplementedException();
}
