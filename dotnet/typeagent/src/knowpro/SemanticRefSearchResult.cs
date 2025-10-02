// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class SemanticRefSearchResult
{
    public ISet<string> TermMatches { get; set; }
    public IList<ScoredSemanticRefOrdinal> SemanticRefMatches { get; set; }
}
