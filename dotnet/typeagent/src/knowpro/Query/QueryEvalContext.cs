// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class QueryEvalContext
{
    DictionaryCache<int, SemanticRef> _semanticRefs;
    public QueryEvalContext(IConversation conversation, CancellationToken cancellationToken)
    {
        Conversation = conversation;
        _semanticRefs = [];
        CancellationToken = cancellationToken;
    }

    public IConversation Conversation { get; private set; }

    public CancellationToken CancellationToken { get; private set; }

    public Task<SemanticRef> GetSemanticRef(int semanticRefOrdinal, CancellationToken cancellationToken)
    {
        return _semanticRefs.GetCachedOrLoadAsync(
            semanticRefOrdinal,
            LoadSemanticRef,
            CancellationToken
        );
    }

    public Task<IList<SemanticRef>> GetSemanticRefs(IList<int> semanticRefOrdinals, CancellationToken cancellationToken)
    {
        return _semanticRefs.GetCachedOrLoadAsync(
            semanticRefOrdinals,
            LoadSemanticRefs,
            CancellationToken
        );
    }

    Task<IList<SemanticRef>> LoadSemanticRefs(IList<int> ordinals, CancellationToken cancellationToken)
    {
        return Conversation.SemanticRefs.GetAsync(ordinals, cancellationToken);
    }

    Task<SemanticRef> LoadSemanticRef(int ordinal, CancellationToken cancellationToken)
    {
        return Conversation.SemanticRefs.GetAsync(ordinal, cancellationToken);
    }
}
