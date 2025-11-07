// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermToRelatedTermsLookup
{
    ValueTask<IList<Term>?> LookupTermAsync(string text, CancellationToken cancellationToken = default);

    ValueTask<IDictionary<string, IList<Term>>?> LookupTermsAsync(IList<string> texts, CancellationToken cancellationToken = default);
}

public interface ITermToRelatedTermsIndex : ITermToRelatedTermsLookup
{
    ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default);

    ValueTask<IList<string>> GetTermsAsync(CancellationToken cancellationToken = default);

    ValueTask AddTermAsync(string text, Term relatedTerm, CancellationToken cancellationToken = default);

    // TODO: consider IReadOnlyList
    ValueTask AddTermAsync(string text, IList<Term> relatedTerms, CancellationToken cancellationToken = default);

    ValueTask ClearAsync(CancellationToken cancellationToken = default);
}

public static class TermToRelatedTermIndexExtensions
{
    public static async ValueTask AddAsync(
        this ITermToRelatedTermsIndex index,
        AliasMap aliases,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(aliases, nameof(aliases));

        foreach (var map in aliases)
        {
            await index.AddTermAsync(
                map.Key,
                map.Value,
                cancellationToken
            ).ConfigureAwait(false);
        }
    }
}
