// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class MatchAccumulator<T>
    where T : notnull
{
    private Dictionary<T, Match<T>> _matches;

    public MatchAccumulator(IEqualityComparer<T>? comparer = null)
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

    public IEnumerable<Match<T>> GetMatches() => _matches.Values;

    public IEnumerable<Match<T>> GetMatches(Func<Match<T>, bool> predicate)
    {
        return _matches.Values.Where(predicate);
    }

    public IEnumerable<T> GetMatchedValues() => _matches.Keys;

    public List<T> ToValues() => _matches.Values.Map((m) => m.Value);

    public void SetMatches(IEnumerable<Match<T>> matches, bool clear = false)
    {
        ArgumentVerify.ThrowIfNull(matches, nameof(matches));

        if (clear)
        {
            Clear();
        }
        foreach (var match in matches)
        {
            SetMatch(match);
        }
    }

    public int GetMaxHitCount()
    {
        int maxHitCount = 0;
        foreach (var match in _matches.Values)
        {
            if (match.HitCount > maxHitCount)
            {
                maxHitCount = match.HitCount;
            }
        }
        return maxHitCount;
    }

    public void AddExact(T value, double score)
    {
        if (_matches.TryGetValue(value, out var existingMatch))
        {
            existingMatch.HitCount++;
            existingMatch.Score += score;
        }
        else
        {
            _matches[value] = new Match<T>
            {
                Value = value,
                HitCount = 1,
                Score = score,
                RelatedHitCount = 0,
                RelatedScore = 0
            };
        }
    }

    public void AddRelated(T value, double score)
    {
        if (_matches.TryGetValue(value, out var existingMatch))
        {
            existingMatch.RelatedHitCount++;
            existingMatch.RelatedScore += score;
        }
        else
        {
            _matches[value] = new Match<T>
            {
                Value = value,
                HitCount = 1,
                Score = 0,
                RelatedHitCount = 1,
                RelatedScore = score
            };
        }
    }

    public void Add(T value, double score, bool isExact)
    {
        if (isExact)
        {
            AddExact(value, score);
        }
        else
        {
            AddRelated(value, score);
        }
    }

    public void AddUnion(MatchAccumulator<T> other)
    {
        ArgumentVerify.ThrowIfNull(other, nameof(other));

        AddUnion(other._matches.Values);
    }

    public void AddUnion(IEnumerable<Match<T>> otherMatches)
    {
        ArgumentVerify.ThrowIfNull(otherMatches, nameof(otherMatches));

        foreach (var otherMatch in otherMatches)
        {
            if (_matches.TryGetValue(otherMatch.Value, out var existingMatch))
            {
                CombineMatches(existingMatch, otherMatch);
            }
            else
            {
                _matches[otherMatch.Value] = otherMatch;
            }
        }
    }

    public MatchAccumulator<T> Intersect(MatchAccumulator<T> other, MatchAccumulator<T> intersection)
    {
        ArgumentVerify.ThrowIfNull(other, nameof(other));
        ArgumentVerify.ThrowIfNull(intersection, nameof(intersection));

        foreach (var thisMatch in GetMatches())
        {
            var otherMatch = other[thisMatch.Value];
            if (otherMatch is not null)
            {
                CombineMatches(thisMatch, otherMatch);
                intersection.SetMatch(thisMatch);
            }
        }
        return intersection;
    }

    public void CalculateTotalScore(Action<Match<T>>? scorer = null)
    {
        scorer ??= Ranker.AddSmoothRelatedScoreToMatchScore;
        foreach (var match in GetMatches())
        {
            scorer(match);
        }
    }

    public void SmoothScores()
    {
        // Normalize the score relative to # of hits.
        foreach (var match in GetMatches())
        {
            if (match.HitCount > 0)
            {
                match.Score = Ranker.GetSmoothScore(match.Score, match.HitCount);
            }
        }
    }

    public List<Match<T>> GetSortedByScore(int minHitCount = -1)
    {
        if (_matches.Count == 0)
        {
            return [];
        }
        List<Match<T>> matches = [.. MatchesWithMinHitCount(minHitCount)];
        matches.Sort((x, y) => y.Score.CompareTo(x.Score));
        return matches;
    }

    public List<Match<T>> GetTopNScoring(int maxMatches = -1, int minHitCount = -1)
    {
        if (Count == 0)
        {
            return [];
        }

        if (maxMatches > 0)
        {
            var topList = new TopNCollection<Match<T>>(maxMatches);
            foreach (var match in MatchesWithMinHitCount(minHitCount))
            {
                topList.Add(match, match.Score);
            }
            var ranked = topList.ByRankAndClear();
            return ranked.Map((m) => m.Item);
        }
        else
        {
            return GetSortedByScore(minHitCount);
        }
    }

    public int SelectTopNScoring(int maxMatches = -1, int minHitCount = -1)
    {
        var topN = GetTopNScoring(maxMatches, minHitCount);
        this.SetMatches(topN, true);
        return topN.Count;
    }

    public List<Match<T>> GetWithHitCount(int minHitCount)
    {
        return [.. MatchesWithMinHitCount(minHitCount)];
    }

    /// <summary>
    /// Selects and retains only items with hitCount >= minHitCount.
    /// </summary>
    public int SelectWithHitCount(int minHitCount)
    {
        var matches = GetWithHitCount(minHitCount);
        SetMatches(matches, true);
        return matches.Count;
    }

    private void CombineMatches(Match<T> target, Match<T> source)
    {
        target.HitCount += source.HitCount;
        target.Score += source.Score;
        target.RelatedHitCount += source.RelatedHitCount;
        target.RelatedScore += source.RelatedScore;
    }

    private IEnumerable<Match<T>> MatchesWithMinHitCount(int minHitCount)
    {
        return minHitCount > 0
            ? GetMatches((m) => m.HitCount >= minHitCount)
            : GetMatches();
    }

}
