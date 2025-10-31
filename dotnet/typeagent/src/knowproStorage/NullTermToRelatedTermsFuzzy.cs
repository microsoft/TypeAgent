// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage;

/// <summary>
/// Null-object implementation of ITermToRelatedTermsFuzzy used when fuzzy (embedding) indexing is disabled.
/// All operations are no-ops and lookups return empty collections.
/// </summary>
public sealed class NullTermToRelatedTermsFuzzy : ITermToRelatedTermsFuzzy
{
#pragma warning disable CS0067
    public event Action<BatchProgress> OnIndexed;
#pragma warning restore CS0067

    public ValueTask<int> GetCountAsync(CancellationToken cancellationToken = default)
        => ValueTask.FromResult(0);

    public ValueTask AddTermsAsync(IList<string> texts, CancellationToken cancellationToken = default)
        => ValueTask.CompletedTask;

    public ValueTask<IList<Term>> LookupTermAsync(
        string text,
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default)
        => ValueTask.FromResult<IList<Term>>([]);

    public ValueTask<IList<IList<Term>>> LookupTermsAsync(
        IList<string> texts,
        int? maxMatches = null,
        double? minScore = null,
        CancellationToken cancellationToken = default)
        => ValueTask.FromResult<IList<IList<Term>>>([]);

    public ValueTask ClearAsync(CancellationToken cancellation = default)
        => ValueTask.CompletedTask;
}

