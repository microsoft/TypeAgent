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

        var filtered = await FilterAsync(
            context,
            scoredOrdinals,
            filter,
            scoreBooster
        ).ConfigureAwait(false);

        return filtered ?? scoredOrdinals;
    }

    public static async ValueTask<IList<ScoredSemanticRefOrdinal>?> FilterAsync(
        QueryEvalContext context,
        IList<ScoredSemanticRefOrdinal> scoredOrdinals,
        Func<SemanticRef, ScoredSemanticRefOrdinal, bool>? filter = null,
        ScoreBooster? scoreBooster = null
    )
    {
        IList<SemanticRef> selectedRefs = await context.SemanticRefs.GetAsync(scoredOrdinals).ConfigureAwait(false);

        IList<ScoredSemanticRefOrdinal>? filtered = null;
        int count = selectedRefs.Count;
        for (int i = 0; i < count; ++i)
        {
            SemanticRef semanticRef = selectedRefs[i];
            ScoredSemanticRefOrdinal scoredOrdinal = scoredOrdinals[i];
            if (filter is not null)
            {
                if (!filter(semanticRef, scoredOrdinal))
                {
                    continue;
                }
                if (scoreBooster is not null)
                {
                    scoredOrdinal = scoreBooster(semanticRef, scoredOrdinal);
                }
                filtered ??= [];
                filtered.Add(scoredOrdinal);
            }
            else if (scoreBooster is not null)
            {
                scoredOrdinals[i] = scoreBooster(semanticRef, scoredOrdinal);
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

    public static async ValueTask<IList<ScoredSemanticRefOrdinal>> LookupPropertyAsync(
        this IPropertyToSemanticRefIndex propertyIndex,
        QueryEvalContext context,
        string propertyName,
        string propertyValue,
        TextRangesInScope? rangesInScope
    )
    {
        var scoredRefs = await propertyIndex.LookupPropertyAsync(
            propertyName,
            propertyValue,
            context.CancellationToken
        ).ConfigureAwait(false);
        if (!scoredRefs.IsNullOrEmpty() && rangesInScope is not null)
        {
            scoredRefs = await FilterAsync(
                context,
                scoredRefs,
                (sr, ordinal) => rangesInScope.IsRangeInScope(sr.Range)
            ).ConfigureAwait(false);
        }
        return scoredRefs;
    }

    public static async ValueTask<IList<ScoredSemanticRefOrdinal>?> LookupAllAsync(
        this ISemanticRefCollection semanticRefs,
        QueryEvalContext context,
        KnowledgeType knowledgeType,
        TextRangesInScope? rangesInScope,
        ScoreBooster? scoreBooster = null
    )
    {
        IList<ScoredSemanticRefOrdinal> scoredOrdinals = await semanticRefs.GetAllOrdinalsAsync(
            knowledgeType
        ).ConfigureAwait(false);

        if (rangesInScope is null)
        {
            return scoredOrdinals;
        }

        // TODO: avoid this double alloction
        IList<TextRange> ranges = await semanticRefs.GetTextRangeAsync(
            scoredOrdinals.ToOrdinals()
        ).ConfigureAwait(false);

        List<ScoredSemanticRefOrdinal> scoredRefs = [];
        int count = ranges.Count;
        for (int i = 0; i < count; ++i)
        {
            if (rangesInScope.IsRangeInScope(ranges[i]))
            {
                scoredRefs.Add(scoredOrdinals[i]);
            }
        }
        return scoredRefs;
    }
}
