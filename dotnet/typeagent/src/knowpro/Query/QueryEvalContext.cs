// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Buffers;

namespace TypeAgent.KnowPro.Query;

internal class QueryEvalContext
{
    DictionaryCache<int, SemanticRef> _semanticRefs;

    public QueryEvalContext(IConversation conversation, CancellationToken cancellationToken = default)
    {
        CancellationToken = cancellationToken;

        Conversation = conversation;
        _semanticRefs = [];
        MatchedTerms = new TermSet();
    }

    public IConversation Conversation { get; private set; }

    public ITermToSemanticRefIndex SemanticRefIndex => Conversation.SemanticRefIndex;

    public TermSet MatchedTerms { get; private set; }

    public TextRangesInScope? TextRangesInScope { get; set; }

    public CancellationToken CancellationToken { get; private set; }

    public void ClearMatchedTerms()
    {
        MatchedTerms.Clear();
    }

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
