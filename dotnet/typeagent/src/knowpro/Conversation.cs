// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class Conversation<TMessage> : IConversation<TMessage>, IConversation, IDisposable
    where TMessage : IMessage, new()
{
    private IStorageProvider<TMessage> _storageProvider;

    public Conversation(ConversationSettings settings, IStorageProvider<TMessage> provider)
    {
        ArgumentVerify.ThrowIfNull(settings, nameof(settings));
        ArgumentVerify.ThrowIfNull(provider, nameof(provider));

        Settings = settings;
        _storageProvider = provider;
    }

    public ConversationSettings Settings { get; }

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

public class ConversationSecondaryIndexes : IConversationSecondaryIndexes
{
    public ConversationSecondaryIndexes(
        IPropertyToSemanticRefIndex propertyIndex,
        ITimestampToTextRangeIndex timestampIndex,
        ITermToRelatedTermIndex relatedTermIndex,
        IMessageTextIndex messageIndex
    )
    {
        ArgumentVerify.ThrowIfNull(propertyIndex, nameof(propertyIndex));
        ArgumentVerify.ThrowIfNull(timestampIndex, nameof(timestampIndex));
        ArgumentVerify.ThrowIfNull(relatedTermIndex, nameof(relatedTermIndex));
        ArgumentVerify.ThrowIfNull(messageIndex, nameof(messageIndex));

        PropertyToSemanticRefIndex = propertyIndex;
        TimestampIndex = timestampIndex;
        TermToRelatedTermsIndex = relatedTermIndex;
        MessageIndex = messageIndex;
    }

    public IPropertyToSemanticRefIndex PropertyToSemanticRefIndex { get; }
    public ITimestampToTextRangeIndex TimestampIndex { get; }
    public ITermToRelatedTermIndex TermToRelatedTermsIndex { get; }

    public IMessageTextIndex MessageIndex { get; }
}
