// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class Conversation<TMessage> : IConversation<TMessage>
    where TMessage : IMessage, new()
{
    private IStorageProvider<TMessage> _storageProvider;
    private Conversation _readonlyConversation;

    public Conversation(IStorageProvider<TMessage> provider)
        : this(
              provider.TypedMessages,
              provider.SemanticRefs,
              provider.SemanticRefIndex,
              provider.SecondaryIndexes
          )
    {
        _storageProvider = provider;
        _readonlyConversation = new Conversation(provider);
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

        Messages = messages;
        SemanticRefs = semanticRefs;
        SemanticRefIndex = semanticRefIndex;
        SecondaryIndexes = secondaryIndexes;
    }

    public string Name { get; set; }

    public IList<string> Tags { get; set; }

    public IMessageCollection<TMessage> Messages { get; private set; }

    public ISemanticRefCollection SemanticRefs { get; private set; }

    public ITermToSemanticRefIndex SemanticRefIndex { get; private set; }

    public IConversationSecondaryIndexes SecondaryIndexes { get; private set; }
    
    public static implicit operator Conversation(Conversation<TMessage> conversation)
    {
        return conversation._readonlyConversation;
    }
}

public class Conversation : IConversation
{
    public Conversation(IStorageProvider provider)
        : this(
              provider.Messages,
              provider.SemanticRefs,
              provider.SemanticRefIndex,
              provider.SecondaryIndexes
          )
    {
    }

    public Conversation(
        IMessageCollection messages,
        IReadOnlyAsyncCollection<SemanticRef> semanticRefs,
        ITermToSemanticRefIndex semanticRefIndex,
        IConversationSecondaryIndexes secondaryIndexes
    )
    {
        ArgumentNullException.ThrowIfNull(messages, nameof(messages));
        ArgumentNullException.ThrowIfNull(semanticRefs, nameof(semanticRefs));
        ArgumentNullException.ThrowIfNull(semanticRefIndex, nameof(semanticRefIndex));
        ArgumentNullException.ThrowIfNull(secondaryIndexes, nameof(secondaryIndexes));

        Messages = messages;
        SemanticRefs = semanticRefs;
        SemanticRefIndex = semanticRefIndex;
        SecondaryIndexes = secondaryIndexes;
    }

    public IMessageCollection Messages { get; private set; }

    public IReadOnlyAsyncCollection<SemanticRef> SemanticRefs { get; private set; }

    public ITermToSemanticRefIndex SemanticRefIndex { get; private set; }

    public IConversationSecondaryIndexes SecondaryIndexes { get; private set; }
};

public class ConversationSecondaryIndexes : IConversationSecondaryIndexes
{
    public ConversationSecondaryIndexes(IPropertyToSemanticRefIndex propertyIndex, ITimestampToTextRangeIndex timestampIndex)
    {
        ArgumentVerify.ThrowIfNull(propertyIndex, nameof(propertyIndex));
        ArgumentVerify.ThrowIfNull(timestampIndex, nameof(timestampIndex));

        PropertyToSemanticRefIndex = propertyIndex;
        TimestampIndex = timestampIndex;
    }

    public IPropertyToSemanticRefIndex PropertyToSemanticRefIndex { get; private set; }

    public ITimestampToTextRangeIndex TimestampIndex { get; private set; }

    public ITermToRelatedTermIndex TermToRelatedTermsIndex { get; private set; }
}
