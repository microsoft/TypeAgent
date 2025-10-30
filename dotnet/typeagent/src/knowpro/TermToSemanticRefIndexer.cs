// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public static class TermToSemanticRefIndexer
{
    public static ValueTask<string> AddTermAsync(this ITermToSemanticRefIndex index, string term, int semanticRefOrdinal, CancellationToken cancellationToken = default)
    {
        return index.AddTermAsync(term, ScoredSemanticRefOrdinal.New(semanticRefOrdinal), cancellationToken);
    }

    public static async ValueTask AddEntriesAsync(this ITermToSemanticRefIndex index, string term, ScoredSemanticRefOrdinal[] entries, CancellationToken cancellationToken = default)
    {
        // TODO: Bulk operations
        foreach (var entry in entries)
        {
            await index.AddTermAsync(term, entry, cancellationToken).ConfigureAwait(false);
        }
    }
}
