// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermToSemanticRefIndex
{
    Task<int> GetCountAsync(CancellationToken cancellation);
    Task<string[]> GetTermsAsync(CancellationToken cancellation);
    Task<string> AddTermAsync(string term, ScoredSemanticRefOrdinal scoredOrdinal, CancellationToken cancellation);
    Task RemoveTermAsync(string term, int semanticRefOrdinal, CancellationToken cancellation);
    Task ClearAsync(CancellationToken cancellation);

    Task<IList<ScoredSemanticRefOrdinal>> LookupTermAsync(string term, CancellationToken cancellation);
}

public static class TermToSemanticRefIndexEx
{
    public static Task<string> AddTermAsync(this ITermToSemanticRefIndex index, string term, int semanticRefOrdinal)
    {
        return index.AddTermAsync(term, ScoredSemanticRefOrdinal.New(semanticRefOrdinal), default);
    }
}
