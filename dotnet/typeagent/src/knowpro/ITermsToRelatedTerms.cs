// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermsToRelatedTerms
{
    Task<int> GetCountAsync();

    Task<IReadOnlyList<Term>?> LookupTermAsync(string text);

    Task AddRelatedTermAsync(string text, Term relatedTerm);

    Task AddRelatedTermAsync(string text, IReadOnlyList<Term> relatedTerms);

    Task RemoveTermAsync(string text);

    ValueTask ClearAsync(CancellationToken cancellationToken = default);
}
