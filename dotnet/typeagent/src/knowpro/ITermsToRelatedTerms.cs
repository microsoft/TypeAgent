// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermsToRelatedTerms
{
    Task<IReadOnlyList<Term>?> LookupTermAsync(string text);
    Task<int> GetCountAsync();
    Task<bool> IsEmptyAsync();
    Task ClearAsync();
    Task AddRelatedTermAsync(string text, Term relatedTerm);
    Task AddRelatedTermAsync(string text, IReadOnlyList<Term> relatedTerms);
    Task RemoveTermAsync(string text);
}
