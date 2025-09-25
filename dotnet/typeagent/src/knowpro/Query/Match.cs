// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class Match<T>
{
    public T Value { get; set; }

    public double Score { get; set; } // Overall cumulative score.

    public int HitCount { get; set; } // # of hits. Always set to at least 1

    public double RelatedScore { get; set; } // Cumulative from matching related terms or phrases

    public double RelatedHitCount { get; set; } // # of hits from related term matches or phrases
}
