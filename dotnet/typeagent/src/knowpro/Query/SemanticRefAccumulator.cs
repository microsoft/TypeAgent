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

    public HashSet<string> SearchTermMatches { get; }

    public void AddTermMatches(
        Term term,
        IEnumerable<ScoredSemanticRefOrdinal> scoredOrdinals,
        bool isExactMatch,
        float? weight = null
    )
    {
        ArgumentVerify.ThrowIfNull(scoredOrdinals, nameof(scoredOrdinals));

        float termWeight = weight ?? term.Weight ?? 1;
        foreach (var scoredOrdinal in scoredOrdinals)
        {
            Add(scoredOrdinal.SemanticRefOrdinal,
                scoredOrdinal.Score * termWeight,
                isExactMatch
            );
        }
        this.SearchTermMatches.Add(term.Text);
    }

    public void AddTermMatchesIfNew(
        Term term,
        IEnumerable<ScoredSemanticRefOrdinal> scoredOrdinals,
        bool isExactMatch,
        float? weight = null
    )
    {
        ArgumentVerify.ThrowIfNull(scoredOrdinals, nameof(scoredOrdinals));

        var termWeight = weight ?? term.Weight ?? 1;
        foreach (var scoredOrdinal in scoredOrdinals)
        {
            if (!Has(scoredOrdinal.SemanticRefOrdinal))
            {
                Add(
                    scoredOrdinal.SemanticRefOrdinal,
                    scoredOrdinal.Score * termWeight,
                    isExactMatch
                );
            }
        }
        this.SearchTermMatches.Add(term.Text);
    }
}
