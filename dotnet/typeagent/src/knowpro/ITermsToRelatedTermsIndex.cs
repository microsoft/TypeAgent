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

    ValueTask ClearAsync(CancellationToken cancellationToken = default);
}

public static class TermsToRelatedTermsIndexExtensions
{
    public static ValueTask ResolveRelatedTermsAsync(
        this ITermsToRelatedTermsIndex relatedTermsIndex,
        IList<SearchTermGroup> compiledTerms,
        bool ensureSingleOccurence
    )
    {
        //List<SearchTerm> allSearchTerms = compiledTerms.FlatMap((ct) => ct.term)
        throw new NotImplementedException();
    }
}
