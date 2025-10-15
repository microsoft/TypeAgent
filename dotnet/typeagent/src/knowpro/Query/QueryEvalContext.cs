// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Buffers;

namespace TypeAgent.KnowPro.Query;

internal class QueryEvalContext
{
    IConversationCache _cache;

    public QueryEvalContext(
        IConversation conversation,
        IConversationCache? cache = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(cache, nameof(cache));

        CancellationToken = cancellationToken;

        Conversation = conversation;

        _cache = cache ?? new ConversationCache(conversation);

        MatchedTerms = new TermSet();
        MatchedPropertyTerms = new PropertyTermSet();
    }

    public IConversation Conversation { get; }

    public IAsyncCollectionReader<SemanticRef> SemanticRefs => _cache.SemanticRefs;

    public IAsyncCollectionReader<IMessage> Messages => _cache.Messages;

    public ITermToSemanticRefIndex SemanticRefIndex => Conversation.SemanticRefIndex;

    public IPropertyToSemanticRefIndex PropertyIndex => Conversation.SecondaryIndexes.PropertyToSemanticRefIndex;

    public TermSet MatchedTerms { get; private set; }

    public PropertyTermSet MatchedPropertyTerms { get; private set; }

    public TextRangesInScope? TextRangesInScope { get; set; }

    public IDictionary<KnowledgeType, SemanticRefSearchResult>? KnowledgeMatches { get; set; }

    public CancellationToken CancellationToken { get; set; }

    public void ClearMatchedTerms()
    {
        MatchedTerms.Clear();
        MatchedPropertyTerms.Clear();
    }
}
