// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermToSemanticRefIndex
{
    Task<int> GetCountAsync();
    Task<string[]> GetTermsAsync();
    Task<string> AddTermAsync(string term, ScoredSemanticRefOrdinal scoredOrdinal);
    Task RemoveTermAsync(string term, int semanticRefOrdinal);
    Task ClearAsync();

    Task<ScoredSemanticRefOrdinal[]> LookupTermAsync(string term);
}

public static class TermToSemanticRefIndexEx
{
    public static Task<string> AddTermAsync(this ITermToSemanticRefIndex index, string term, int semanticRefOrdinal)
    {
        return index.AddTermAsync(term, ScoredSemanticRefOrdinal.New(semanticRefOrdinal));
    }
}