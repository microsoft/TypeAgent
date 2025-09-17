// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermToSemanticRefIndex
{
    Task<int> GetCountAsync();
    Task<string[]> GetTermsAsync();
    Task<string> AddTermAsync(string term, ScoredSemanticRefOrdinal scoredOrdinal);
    Task RemoveTermAsync(string term, SemanticRefOrdinal ordinal);
    Task ClearAsync();

    Task<ScoredSemanticRefOrdinal[]> LookupTermAsync(string term);
}

public static class TermToSemanticRefIndexEx
{
    public static Task<string> AddTermAsync(this ITermToSemanticRefIndex index, string term, SemanticRefOrdinal ordinal)
    {
        return index.AddTermAsync(term, ScoredSemanticRefOrdinal.New(ordinal));
    }
}