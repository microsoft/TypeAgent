// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermToSemanticRefIndex
{
    Task<int> GetSizeAsync();
    Task<string[]> GetTermsAsync();
    Task<string> AddTermAsync(string term, ScoredSemanticRefOrdinal scoredOrdinal);
}

public static class ITermToSemanticRefIndexEx
{
    public static Task<string> AddTermAsync(this ITermToSemanticRefIndex index, string term, SemanticRefOrdinal ordinal)
    {
        return index.AddTermAsync(term, new ScoredSemanticRefOrdinal { Score = 1, SemanticRefOrdinal = ordinal });
    }
}