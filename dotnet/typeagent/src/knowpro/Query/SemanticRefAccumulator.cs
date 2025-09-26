// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class SemanticRefAccumulator : MatchAccumulator<int>
{
    public SemanticRefAccumulator()
        : base()
    {
        SearchTermMatches = [];
    }

    public HashSet<string> SearchTermMatches { get; private set; }
}
