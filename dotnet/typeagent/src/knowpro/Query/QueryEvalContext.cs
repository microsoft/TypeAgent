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

    public ITermToSemanticRefIndex SemanticRefIndex => Conversation.SemanticRefIndex;

    public TextRangesInScope? TextRangesInScope { get; set; }

    public CancellationToken CancellationToken { get; private set; }

    public ValueTask<SemanticRef> GetSemanticRefAsync(int semanticRefOrdinal)
    {
        return _semanticRefs.GetOrLoadAsync(
            semanticRefOrdinal,
            LoadSemanticRef,
            CancellationToken
        );
    }

    public ValueTask<IList<SemanticRef>> GetSemanticRefsAsync(IList<int> semanticRefOrdinals)
    {
        return _semanticRefs.GetOrLoadAsync(
            semanticRefOrdinals,
            LoadSemanticRefs,
            CancellationToken
        );
    }

    public ValueTask<IList<SemanticRef>> GetSemanticRefsAsync(IList<ScoredSemanticRefOrdinal> scoredOrdinals)
    {
        IList<int> ordinals = [.. scoredOrdinals.ToSemanticRefOrdinals()];
        return GetSemanticRefsAsync(ordinals);
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
