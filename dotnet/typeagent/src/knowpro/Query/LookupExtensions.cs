// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal static class LookupExtensions
{
    internal static async Task<IList<ScoredSemanticRefOrdinal>?> LookupTermFilteredAsync(
        this ITermToSemanticRefIndex semanticRefIndex,
        Term term,
        ISemanticRefCollection semanticRefs,
        Func<SemanticRef, ScoredSemanticRefOrdinal, bool> filter,
        CancellationToken cancellationToken = default
    )
    {
        var scoredRefs = await semanticRefIndex.LookupTermAsync(term.Text, cancellationToken).ConfigureAwait(false);
        if (scoredRefs.IsNullOrEmpty())
        {
            return null;
        }
        IList<SemanticRef> selectedRefs = await semanticRefs.GetAsync(
            ScoredSemanticRefOrdinal.ToSemanticRefOrdinals(scoredRefs),
            cancellationToken
        ).ConfigureAwait(false);
        if (selectedRefs.IsNullOrEmpty() || selectedRefs.Count != scoredRefs.Count)
        {
            throw new TypeAgentException();
        }
        IList<ScoredSemanticRefOrdinal> filtered = [];
        for (int i = 0; i < selectedRefs.Count; ++i)
        {
            if (filter(selectedRefs[i], scoredRefs[i]))
            {
                filtered.Add(scoredRefs[i]);
            }
        }
        return filtered;
    }

    public static Task<IList<ScoredSemanticRefOrdinal>?> LookupTermAsync(
        this ITermToSemanticRefIndex semanticRefIndex,
        Term term,
        ISemanticRefCollection semanticRefs,
        TextRangesInScope? rangesInScope,
        string? kType,
        CancellationToken cancellationToken = default
    )
    {
        if (rangesInScope is not null)
        {
            // If rangesInScope has no actual text ranges, then lookups can't possibly match
            return semanticRefIndex.LookupTermFilteredAsync(
                term,
                semanticRefs,
                (sr, ordinal) =>
                {
                    if (kType is not null && sr.KnowledgeType != kType)
                    {
                        return false;
                    }
                    return rangesInScope.IsRangeInScope(sr.Range);
                },
                cancellationToken
            );
        }
        return semanticRefIndex.LookupTermAsync(term.Text, cancellationToken);
    }

}
