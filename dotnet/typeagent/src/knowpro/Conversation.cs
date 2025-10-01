// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class Conversation<TMessage> : IConversation<TMessage>, IDisposable
    where TMessage : IMessage, new()
{
    private IStorageProvider<TMessage> _storageProvider;
    private readonly Conversation _readonlyConversation;

    public Conversation(IStorageProvider<TMessage> provider)
    {
        ArgumentVerify.ThrowIfNull(provider, nameof(provider));
        _storageProvider = provider;
        _readonlyConversation = new Conversation(provider);
    }

    public IMessageCollection<TMessage> Messages => _storageProvider.TypedMessages;

    public ISemanticRefCollection SemanticRefs => _storageProvider.SemanticRefs;

    public ITermToSemanticRefIndex SemanticRefIndex => _storageProvider.SemanticRefIndex;

    public IConversationSecondaryIndexes SecondaryIndexes => _storageProvider.SecondaryIndexes;

    public IConversation AsConversation() => _readonlyConversation;

    public static implicit operator Conversation(Conversation<TMessage> conversation)
    {
        return conversation._readonlyConversation;
    }

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
        ITimestampToTextRangeIndex timestampIndex
    )
    {
        ArgumentVerify.ThrowIfNull(propertyIndex, nameof(propertyIndex));
        ArgumentVerify.ThrowIfNull(timestampIndex, nameof(timestampIndex));

        PropertyToSemanticRefIndex = propertyIndex;
        TimestampIndex = timestampIndex;
    }

    public IPropertyToSemanticRefIndex PropertyToSemanticRefIndex { get; private set; }

    public ITimestampToTextRangeIndex TimestampIndex { get; private set; }

    //public ITermToRelatedTermIndex TermToRelatedTermsIndex { get; private set; }
}
