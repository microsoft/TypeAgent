// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class Conversation<TMessage> : IConversation<TMessage>
    where TMessage : IMessage, new()
{
    private IStorageProvider<TMessage> _storageProvider;

    public Conversation(IStorageProvider<TMessage> provider)
        : this(
              provider.Messages,
              provider.SemanticRefs,
              provider.SemanticRefIndex,
              provider.SecondaryIndexes
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
}

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
