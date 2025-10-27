// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

public class TextEmbeddingModelWithCache : ITextEmbeddingModel
{
    public TextEmbeddingModelWithCache(int maxCacheSize)
        : this(new TextEmbeddingModel(), new TextEmbeddingCache(maxCacheSize))
    {
    }

    public TextEmbeddingModelWithCache(
        ITextEmbeddingModel innerModel,
        TextEmbeddingCache cache
    )
    {
        ArgumentVerify.ThrowIfNull(innerModel, nameof(innerModel));
        ArgumentVerify.ThrowIfNull(cache, nameof(cache));

        InnerModel = innerModel;
        Cache = cache;
        CacheEnabled = true;
    }

    public ITextEmbeddingModel InnerModel { get; }

    public TextEmbeddingCache Cache { get; }

    public bool CacheEnabled { get; set; }

    public int MaxBatchSize => InnerModel.MaxBatchSize;

    public async Task<float[]> GenerateAsync(string text, CancellationToken cancellationToken)
    {
        if (CacheEnabled)
        {
            return await Cache.GetOrLoadAsync(
                text,
                async (text, ct) => {
                    var result = await InnerModel.GenerateAsync(text, cancellationToken).ConfigureAwait(false);
                    return result;
                },
                cancellationToken
            );
        }
        return await InnerModel.GenerateAsync(text, cancellationToken).ConfigureAwait(false);
    }

    public async Task<IList<float[]>> GenerateAsync(IList<string> texts, CancellationToken cancellationToken)
    {
        return CacheEnabled
            ? await Cache.GetOrLoadAsync(
                texts,
                async (t, ct) =>
                {
                    var results = await InnerModel.GenerateAsync(t, ct);
                    return results;
                },
                cancellationToken
            ).ConfigureAwait(false)
            : await InnerModel.GenerateAsync(texts, cancellationToken).ConfigureAwait(false);
    }
}
