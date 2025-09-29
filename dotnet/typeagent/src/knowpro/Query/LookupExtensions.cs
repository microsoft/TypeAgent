// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal static class LookupExtensions
{
    /// <summary>
    /// 
    /// </summary>
    /// <param name="semanticRefIndex"></param>
    /// <param name="context"></param>
    /// <param name="term">The actual term from SearchTerm to lookup</param>
    /// <param name="filter"></param>
    /// <param name="scoreBooster"></param>
    /// <returns></returns>
    internal static async ValueTask<IList<ScoredSemanticRefOrdinal>?> LookupTermAsync(
        this ITermToSemanticRefIndex semanticRefIndex,
        QueryEvalContext context,
        Term term,
        Func<SemanticRef, ScoredSemanticRefOrdinal, bool>? filter = null,
        ScoreBooster? scoreBooster = null
    )
    {
        var scoredOrdinals = await semanticRefIndex.LookupTermAsync(
            term.Text,
            context.CancellationToken
            ).ConfigureAwait(false);

        if (scoredOrdinals is null ||
            scoredOrdinals.IsNullOrEmpty()
        )
        {
            return null;
        }
        if (filter is null && scoreBooster is null)
        {
            return scoredOrdinals;
        }

        IList<SemanticRef> selectedRefs = await context.GetSemanticRefsAsync(scoredOrdinals).ConfigureAwait(false);

        IList<ScoredSemanticRefOrdinal>? filtered = null;
        for (int i = 0; i < selectedRefs.Count; ++i)
        {
            SemanticRef semanticRef = selectedRefs[i];
            ScoredSemanticRefOrdinal scoredOrdinal = scoredOrdinals[i];
            if (filter is not null)
            {
                if (!filter(semanticRef, scoredOrdinal))
                {
                    continue;
                }
                filtered ??= [];
                filtered.Add(scoredOrdinal);
            }
            if (scoreBooster is not null)
            {
                scoredOrdinals[i] = scoreBooster(term, semanticRef, scoredOrdinal);
            }
        }
        return filtered ?? scoredOrdinals;
    }

    public static ValueTask<IList<ScoredSemanticRefOrdinal>?> LookupTermAsync(
        this ITermToSemanticRefIndex semanticRefIndex,
        QueryEvalContext context,
        Term term,
        TextRangesInScope? rangesInScope,
        KnowledgeType? kType = null,
        ScoreBooster? scoreBooster = null
    )
    {
        // If rangesInScope has no actual text ranges, then lookups can't possibly match
        return semanticRefIndex.LookupTermAsync(
            context,
            term,
            (sr, ordinal) =>
            {
                return (kType is null || sr.KnowledgeType == kType) &&
                (rangesInScope is null || rangesInScope.IsRangeInScope(sr.Range));
            },
            scoreBooster
        );
    }
}
