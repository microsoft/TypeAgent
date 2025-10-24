// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class Conversation<TMessage> : IConversation<TMessage>, IConversation, IDisposable
    where TMessage : IMessage, new()
{
    private IStorageProvider<TMessage> _storageProvider;

    public Conversation(IStorageProvider<TMessage> provider)
    {
        ArgumentVerify.ThrowIfNull(provider, nameof(provider));
        _storageProvider = provider;
    }

    public IMessageCollection<TMessage> Messages => _storageProvider.TypedMessages;

    public ISemanticRefCollection SemanticRefs => _storageProvider.SemanticRefs;

    public ITermToSemanticRefIndex SemanticRefIndex => _storageProvider.SemanticRefIndex;

    public IConversationSecondaryIndexes SecondaryIndexes => _storageProvider.SecondaryIndexes;

    // If used as IConversation, return a message collection of IMessage
    // Keeps the .NET type system happy
    IMessageCollection IConversation.Messages => _storageProvider.Messages;

    protected virtual void Dispose(bool disposing)
    {
        if (_storageProvider is not null && disposing)
        {
            _storageProvider.Dispose();
            _storageProvider = null;
        }
    }

    public void Dispose()
    {
        // Do not change this code. Put cleanup code in 'Dispose(bool disposing)' method
        Dispose(disposing: true);
        GC.SuppressFinalize(this);
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

    public Conversation(IConversation conversation)
        : this(
              conversation.Messages,
              conversation.SemanticRefs,
              conversation.SemanticRefIndex,
              conversation.SecondaryIndexes
        )
    {
    }

    public Conversation(
        IMessageCollection messages,
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

    public IMessageCollection Messages { get; private set; }

    public ISemanticRefCollection SemanticRefs { get; private set; }

    public ITermToSemanticRefIndex SemanticRefIndex { get; private set; }

    public IConversationSecondaryIndexes SecondaryIndexes { get; private set; }
};

public class ConversationSecondaryIndexes : IConversationSecondaryIndexes
{
    public ConversationSecondaryIndexes(
        IPropertyToSemanticRefIndex propertyIndex,
        ITimestampToTextRangeIndex timestampIndex,
        ITermToRelatedTermIndex relatedTermIndex
    )
    {
        ArgumentVerify.ThrowIfNull(propertyIndex, nameof(propertyIndex));
        ArgumentVerify.ThrowIfNull(timestampIndex, nameof(timestampIndex));
        ArgumentVerify.ThrowIfNull(relatedTermIndex, nameof(relatedTermIndex));

        PropertyToSemanticRefIndex = propertyIndex;
        TimestampIndex = timestampIndex;
        TermToRelatedTermsIndex = relatedTermIndex;
    }

    public IPropertyToSemanticRefIndex PropertyToSemanticRefIndex { get; private set; }

    public ITimestampToTextRangeIndex TimestampIndex { get; private set; }

    public ITermToRelatedTermIndex TermToRelatedTermsIndex { get; private set; }
}
