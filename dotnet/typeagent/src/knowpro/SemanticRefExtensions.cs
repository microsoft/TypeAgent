// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public static class SemanticRefExtensions
{
    public static IEnumerable<int> ToSemanticRefOrdinals(
        this IEnumerable<ScoredSemanticRefOrdinal> items
    )
    {
        return from item in items
               select item.SemanticRefOrdinal;
    }

    public static Task<IList<SemanticRef>> GetAsync(
        this ISemanticRefCollection semanticRefs,
        IList<ScoredSemanticRefOrdinal> scoredOrdinals,
        CancellationToken cancellationToken = default)
    {

        return semanticRefs.GetAsync(
            [.. scoredOrdinals.ToSemanticRefOrdinals()],
            cancellationToken
        );
    }

}
