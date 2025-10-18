// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermToSemanticRefIndex
{
    ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default);

    ValueTask<IList<string>> GetTermsAsync(CancellationToken cancellationToken = default);

    ValueTask<string> AddTermAsync(string term, ScoredSemanticRefOrdinal scoredOrdinal, CancellationToken cancellationToken = default);

    ValueTask RemoveTermAsync(string term, int semanticRefOrdinal, CancellationToken cancellationToken = default);

    ValueTask ClearAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Looks up a term and retrieves its associated scored semantic reference ordinals.
    /// </summary>
    /// <param name="term">The term to look up</param>
    /// <param name="cancellationToken"></param>
    /// <returns>
    /// If term found: A list of scored semantic ref ordinals
    /// If term not found: null
    /// </returns>
    ValueTask<IList<ScoredSemanticRefOrdinal>?> LookupTermAsync(string term, CancellationToken cancellationToken = default);
}

public static class TermToSemanticRefIndexExtensions
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
