// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class SemanticRefAccumulator : MatchAccumulator<int>
{
    public SemanticRefAccumulator(HashSet<string>? searchTermMatches = null)
        : base()
    {
        SearchTermMatches = searchTermMatches ?? [];
    }

    public HashSet<string> SearchTermMatches { get; set; }

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

    public void AddUnion(SemanticRefAccumulator other)
    {
        base.AddUnion(other);
        this.SearchTermMatches.AddRange(other.SearchTermMatches);
    }

    public SemanticRefAccumulator Intersect(SemanticRefAccumulator other)
    {
        var intersection = new SemanticRefAccumulator();
        Intersect(other, intersection);
        if (intersection.Count > 0)
        {
            intersection.SearchTermMatches.AddRange(SearchTermMatches);
            intersection.SearchTermMatches.AddRange(other.SearchTermMatches);
        }
        return intersection;
    }

    public async ValueTask<IList<Match<int>>> GetFilteredMatchesAsync(
        QueryEvalContext context,
        Func<QueryEvalContext, SemanticRef, bool> predicate
    )
    {
        var ordinals = ToOrdinals();
        var semanticRefs = await context.SemanticRefs.GetAsync(ordinals).ConfigureAwait(false);
        Debug.Assert(semanticRefs.Count == ordinals.Count);

        List<Match<int>> filtered = [];
        int i = 0;
        foreach (Match<int> match in GetMatches())
        {
            if (predicate(context, semanticRefs[i]))
            {
                filtered.Add(match);
            }
            ++i;
        }
        return filtered;
    }

    public IList<int> ToOrdinals()
    {
        return GetMatches().Map((m) => m.Value);
    }

    public IList<ScoredSemanticRefOrdinal> ToScoredOrdinals()
    {
        return GetSortedByScore(0).Map((m) =>
        {
            return new ScoredSemanticRefOrdinal()
            {
                SemanticRefOrdinal = m.Value,
                Score = m.Score,
            };
        });
    }
}
