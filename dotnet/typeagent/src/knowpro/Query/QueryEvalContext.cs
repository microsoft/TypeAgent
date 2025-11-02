// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Buffers;

namespace TypeAgent.KnowPro.Query;

internal class QueryEvalContext
{
    IConversationCache _cache;

    public QueryEvalContext(
        IConversation conversation,
        CancellationToken cancellationToken = default
    )
    {
        CancellationToken = cancellationToken;

        Conversation = conversation;
        _cache = conversation.Cache;

        MatchedTerms = new TermSet();
        MatchedPropertyTerms = new PropertyTermSet();
    }

    public IConversation Conversation { get; }

    public IConversationCache Cache
    {
        get
        {
            _cache ??= new ConversationCache(Conversation);
            return _cache;
        }
    }

    public IAsyncCollectionReader<SemanticRef> SemanticRefs => Cache.SemanticRefs;

    public IAsyncCollectionReader<IMessage> Messages => Cache.Messages;

    public ITermToSemanticRefIndex SemanticRefIndex => Conversation.SemanticRefIndex;

    public IPropertyToSemanticRefIndex PropertyIndex => Conversation.SecondaryIndexes.PropertyToSemanticRefIndex;

    public ITimestampToTextRangeIndex TimestampIndex => Conversation.SecondaryIndexes.TimestampIndex;

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
