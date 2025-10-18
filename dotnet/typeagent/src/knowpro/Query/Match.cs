// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class Match<T>
{
    public Match()
    {
    }

    public Match(T value, double score, int hitCount)
    {
        Value = value;
        Score = score;
        HitCount = hitCount;
        RelatedHitCount = 0;
        RelatedScore = 0;
    }

    public T Value { get; set; }

    public double Score { get; set; } // Overall cumulative score.

    public int HitCount { get; set; } // # of hits. Always set to at least 1

    public double RelatedScore { get; set; } // Cumulative from matching related terms or phrases

    public int RelatedHitCount { get; set; } // # of hits from related term matches or phrases
}
