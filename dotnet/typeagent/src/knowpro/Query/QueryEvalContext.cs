// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Buffers;

namespace TypeAgent.KnowPro.Query;

internal class QueryEvalContext
{
    public QueryEvalContext(
        IConversation conversation,
        CancellationToken cancellationToken = default
    )
        : this(
              conversation,
              new CachingCollectionReader<SemanticRef>(conversation.SemanticRefs),
              new CachingCollectionReader<IMessage>(conversation.Messages),
              cancellationToken
        )
    {

    }
    public QueryEvalContext(
        IConversation conversation,
        CachingCollectionReader<SemanticRef> semanticRefReader,
        CachingCollectionReader<IMessage> messageReader,
        CancellationToken cancellationToken
    )
    {
        ArgumentVerify.ThrowIfNull(semanticRefReader, nameof(semanticRefReader));
        ArgumentVerify.ThrowIfNull(messageReader, nameof(messageReader));

        CancellationToken = cancellationToken;

        Conversation = conversation;

        SemanticRefs = semanticRefReader;
        Messages = messageReader;
        MatchedTerms = new TermSet();
        MatchedPropertyTerms = new PropertyTermSet();
    }

    public IConversation Conversation { get; }

    public IAsyncCollectionReader<SemanticRef> SemanticRefs { get; }

    public IAsyncCollectionReader<IMessage> Messages { get; }

    public ITermToSemanticRefIndex SemanticRefIndex => Conversation.SemanticRefIndex;

    public IPropertyToSemanticRefIndex PropertyIndex => Conversation.SecondaryIndexes.PropertyToSemanticRefIndex;

    public TermSet MatchedTerms { get; private set; }

    public PropertyTermSet MatchedPropertyTerms { get; private set; }

    public TextRangesInScope? TextRangesInScope { get; set; }

    public CancellationToken CancellationToken { get; set; }

    public void ClearMatchedTerms()
    {
        MatchedTerms.Clear();
        MatchedPropertyTerms.Clear();
    }
}
