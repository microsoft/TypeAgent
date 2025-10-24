// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermsToRelatedTerms
{
    ValueTask AddAsync(string text, Term relatedTerm, CancellationToken cancellationToken = default);

    // TODO: consider IReadOnlyList
    ValueTask AddAsync(string text, IList<Term> relatedTerms, CancellationToken cancellationToken = default);

    ValueTask<IList<Term>?> LookupAsync(string text, CancellationToken cancellationToken = default);

    ValueTask ClearAsync(CancellationToken cancellationToken = default);
}
