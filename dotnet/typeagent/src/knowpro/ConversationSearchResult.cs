// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class ConversationSearchResult
{
    public IList<ScoredMessageOrdinal> MessageMatches { get; set; }
    public IDictionary<KnowledgeType, SemanticRefSearchResult> KnowledgeMatches {get; set;}
    public string? RawSearchQuery { get; set; }
}
