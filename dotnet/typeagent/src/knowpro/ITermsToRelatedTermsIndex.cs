// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermsToRelatedTermsIndex
{
    ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default);

    ValueTask<IList<string>> GetTermsAsync(CancellationToken cancellationToken = default);

    ValueTask AddTermAsync(string text, Term relatedTerm, CancellationToken cancellationToken = default);

    // TODO: consider IReadOnlyList
    ValueTask AddTermAsync(string text, IList<Term> relatedTerms, CancellationToken cancellationToken = default);

    ValueTask<IList<Term>?> LookupTermAsync(string text, CancellationToken cancellationToken = default);

    ValueTask<IDictionary<string, IList<Term>>?> LookupTermAsync(IList<string> texts, CancellationToken cancellationToken = default);

    ValueTask ClearAsync(CancellationToken cancellationToken = default);
}
