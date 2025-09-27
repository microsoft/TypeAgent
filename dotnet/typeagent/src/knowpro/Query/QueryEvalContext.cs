// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class QueryEvalContext
{
    Cache<int, SemanticRef> _semanticRefs;

    public QueryEvalContext(IConversation conversation)
    {
        Conversation = conversation;
        _semanticRefs = new Cache<int, SemanticRef>();
    }

    public IConversation Conversation { get; private set; }

    public Task<SemanticRef> GetSemanticRef(int semanticRefOrdinal, CancellationToken cancellationToken)
    {
        return _semanticRefs.GetCachedOrFetchAsync(
            semanticRefOrdinal,
            (ordinal) => Conversation.SemanticRefs.GetAsync(ordinal, cancellationToken)
        );
    }

    public Task<IList<SemanticRef>> GetSemanticRefs(IList<int> semanticRefOrdinals, CancellationToken cancellationToken)
    {
        return _semanticRefs.GetCachedOrFetchAsync(
            semanticRefOrdinals,
            (ordinals) => Conversation.SemanticRefs.GetAsync(ordinals, cancellationToken)
        );
    }
}
