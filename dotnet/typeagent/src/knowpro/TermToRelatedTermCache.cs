// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro;

public class TermToRelatedTermsFuzzyCache : ITermToRelatedTermsFuzzyLookup
{
    ICache<string, IList<Term>> _cache;
    ITermToRelatedTermsFuzzyLookup _inner;

    public TermToRelatedTermsFuzzyCache(ITermToRelatedTermsFuzzyLookup inner, int? maxCacheSize = null)
        : this(inner, Cache.Create<string, IList<Term>>(maxCacheSize))
    {
    }

    public TermToRelatedTermsFuzzyCache(ITermToRelatedTermsFuzzyLookup inner, ICache<string, IList<Term>> cache)
    {
        ArgumentVerify.ThrowIfNull(inner, nameof(inner));
        ArgumentVerify.ThrowIfNull(cache, nameof(cache));

        _cache = cache;
        _inner = inner;
    }

    public ValueTask<IList<Term>> LookupTermAsync(string text, int? maxMatches = null, double? minScore = null, CancellationToken cancellationToken = default)
    {
        return _cache.GetOrLoadAsync(
            text,
            (key, ct) => _inner.LookupTermAsync(key, maxMatches, minScore, ct)
            ,
            cancellationToken
        );
    }

    public ValueTask<IList<IList<Term>>> LookupTermsAsync(IList<string> texts, int? maxMatches = null, double? minScore = null, CancellationToken cancellationToken = default)
    {
        return _cache.GetOrLoadAsync(
            texts,
            (keys, ct) => _inner.LookupTermsAsync(keys, maxMatches, minScore, ct)
            ,
            cancellationToken
        );
    }
}
