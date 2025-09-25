// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class MatchAccumulator<T>
{
    private Dictionary<T, Match<T>> _matches;

    public MatchAccumulator(IEqualityComparer<T> comparer)
    {
        _matches = new Dictionary<T, Match<T>>(comparer);
    }

    public int Count => _matches.Count;

    public Match<T>? this[T value] => _matches.GetValueOrDefault(value);

    public bool Has(T value) => _matches.ContainsKey(value);

    public void SetMatch(Match<T> match) => _matches[match.Value] = match;

    public void Clear()
    {
        _matches.Clear();
    }
}
