// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class ConversationSearchResult
{
    public ConversationSearchResult(
        IList<ScoredMessageOrdinal> messageMatches,
        string? rawSearchQuery
    )
        : this(new Dictionary<KnowledgeType, SemanticRefSearchResult>(), messageMatches, rawSearchQuery)
    {
    }

    public ConversationSearchResult(
        IDictionary<KnowledgeType, SemanticRefSearchResult> knowledgeMatches,
        IList<ScoredMessageOrdinal> messageMatches,
        string? rawSearchQuery
    )
    {
        ArgumentVerify.ThrowIfNull(knowledgeMatches, nameof(knowledgeMatches));
        ArgumentVerify.ThrowIfNull(messageMatches, nameof(messageMatches));

        KnowledgeMatches = knowledgeMatches;
        MessageMatches = messageMatches;
        RawSearchQuery = rawSearchQuery;
    }

    public IList<ScoredMessageOrdinal> MessageMatches { get; }

    public IDictionary<KnowledgeType, SemanticRefSearchResult> KnowledgeMatches { get; }

    public string? RawSearchQuery { get; }
}
