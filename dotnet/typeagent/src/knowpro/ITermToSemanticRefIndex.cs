// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermToSemanticRefIndex
{
    ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default);

    ValueTask<IList<string>> GetTermsAsync(CancellationToken cancellationToken = default);

    ValueTask<string> AddTermAsync(string term, ScoredSemanticRefOrdinal scoredOrdinal, CancellationToken cancellationToken = default);

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

    ValueTask ClearAsync(CancellationToken cancellationToken = default);

    ValueTask<int> GetMaxOrdinalAsync(CancellationToken cancellationToken = default);
}
