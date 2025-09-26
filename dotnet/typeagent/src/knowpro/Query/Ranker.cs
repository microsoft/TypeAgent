// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;

namespace TypeAgent.KnowPro.Query;

internal static class Ranker
{
    /*
    Return a score that smoothens a totalScore to compensate for multiple potentially noisy hits
    
    1. A totalScore is just all the individual scores from each hit added up. 
    Unfortunately, a larger number of moderately related but noisy matches can overwhelm
    a small # of very good matches merely by having a larger totalScore.
    
    2. We also want diminishing returns for too many hits. Too many hits can be indicative of noise...as the
    they can indicate low entropy of the thing being matched: its too common-place. 
    We want to prevent runaway scores that result from too many matches

    We currently adopt a simple but effective approach to smooth scores. 
    We address (1) by taking an average: this gives a cheap way of measuring the utility of each hit
    We address (2) by using a log function to get a hitCount that diminishes the impact of large # of hits.
    Then we return the average multiplied by the smooth hitCount, giving us a smoother score
    
    This is by no means perfect, but is a good default. 
    MatchAccumulator.calculateTotalScore allows you to pass in a smoothing function.
    As the need arises, we can make that available to code at higher layers. 
   */
    public static double GetSmoothScore(double totalScore, int hitCount)
    {
        if (hitCount > 0)
        {
            if (hitCount == 1)
            {
                return totalScore;
            }
            double avg = totalScore / hitCount;
            double smoothAvg = Math.Log(hitCount + 1) * avg;
            return smoothAvg;
        }

        return 0;
    }

    public static void AddSmoothRelatedScoreToMatchScore<T>(Match<T> match)
    {
        ArgumentVerify.ThrowIfNull(match, nameof(match));
        if (match.RelatedHitCount > 0)
        {
            // Related term matches can be noisy and duplicative. Comments on getSmoothScore explain why
            // we choose to smooth the impact of related term matches
            double smoothRelatedScore = GetSmoothScore(match.RelatedScore, match.RelatedHitCount);
            match.Score += smoothRelatedScore;
        }
    }

}
