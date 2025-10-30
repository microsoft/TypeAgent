// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface ITermToRelatedTermsFuzzyLookup
{
    ValueTask<IList<Term>> LookupTermAsync(string text, int? maxMatches = null, double? minScore = null, CancellationToken cancellationToken = default);

    ValueTask<IList<IList<Term>>> LookupTermsAsync(IList<string> texts, int? maxMatches = null, double? minScore = null, CancellationToken cancellationToken = default);
}

public interface ITermToRelatedTermsFuzzy : ITermToRelatedTermsFuzzyLookup
{
    ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// AddTermsAsync
    /// Idempotent. Should ignore any terms already in the index
    /// </summary>
    /// <param name="texts"></param>
    /// <param name="cancellationToken"></param>
    /// <returns></returns>
    ValueTask AddTermsAsync(IList<string> texts, CancellationToken cancellationToken = default);

    ValueTask ClearAsync(CancellationToken cancellation = default);

    event Action<BatchProgress> OnIndexed;
}

public static class TermToRelatedTermsFuzzyExtensions
{
    public static ValueTask<IList<Term>> LookupTermAsync(
        this ITermToRelatedTermsFuzzy index,
        string text,
        CancellationToken cancellationToken = default
    )
    {
        return index.LookupTermAsync(text, null, null, cancellationToken);
    }
}
