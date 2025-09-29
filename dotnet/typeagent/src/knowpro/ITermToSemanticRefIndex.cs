// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermToSemanticRefIndex
{
    Task<int> GetCountAsync(CancellationToken cancellationToken = default);

    Task<IList<string>> GetTermsAsync(CancellationToken cancellationToken = default);

    Task<string> AddTermAsync(string term, ScoredSemanticRefOrdinal scoredOrdinal, CancellationToken cancellationToken = default);

    Task RemoveTermAsync(string term, int semanticRefOrdinal, CancellationToken cancellationToken = default);

    Task ClearAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Looks up a term and retrieves its associated scored semantic reference ordinals.
    /// </summary>
    /// <param name="term">The term to look up</param>
    /// <param name="cancellationToken"></param>
    /// <returns>
    /// If term found: A list of scored semantic ref ordinals
    /// If term not found: null
    /// </returns>
    Task<IList<ScoredSemanticRefOrdinal>?> LookupTermAsync(string term, CancellationToken cancellationToken = default);
}

public static class TermToSemanticRefIndexEx
{
    public static Task<string> AddTermAsync(this ITermToSemanticRefIndex index, string term, int semanticRefOrdinal, CancellationToken cancellationToken = default)
    {
        return index.AddTermAsync(term, ScoredSemanticRefOrdinal.New(semanticRefOrdinal), cancellationToken);
    }

    public static async Task AddEntriesAsync(this ITermToSemanticRefIndex index, string term, ScoredSemanticRefOrdinal[] entries, CancellationToken cancellationToken = default)
    {
        // TODO: Bulk operations
        foreach (var entry in entries)
        {
            await index.AddTermAsync(term, entry, cancellationToken).ConfigureAwait(false);
        }
    }
}
