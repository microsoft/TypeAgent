// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

public static class TextEmbeddingModelExtensions
{
    public static async ValueTask<NormalizedEmbedding> GenerateNormalizedAsync(
        this ITextEmbeddingModel model,
        string text,
        CancellationToken cancellationToken
    )
    {
        float[] embedding = await model.GenerateAsync(text, cancellationToken).ConfigureAwait(false);
        return NormalizedEmbedding.FromArray(embedding);
    }

    public static async ValueTask<IList<NormalizedEmbedding>> GenerateNormalizedAsync(
        this ITextEmbeddingModel model,
        IList<string> texts,
        CancellationToken cancellationToken
    )
    {
        var embeddings = await model.GenerateAsync(texts, cancellationToken).ConfigureAwait(false);
        return embeddings.Map((e) => NormalizedEmbedding.FromArray(e));
    }

    public static async ValueTask<List<NormalizedEmbedding>> GenerateNormalizedInBatchesAsync(
        this ITextEmbeddingModel model,
        IList<string> texts,
        int batchSize,
        int maxCharsPerChunk,
        int concurrency = 1,
        Action<BatchProgress>? progress = null,
        CancellationToken cancellationToken = default
    )
    {
        IList<float[]> rawEmbeddings = await model.GenerateInBatchesAsync(
            texts,
            batchSize,
            maxCharsPerChunk,
            concurrency,
            progress,
            cancellationToken
        ).ConfigureAwait(false);
        return rawEmbeddings.Map((array) => NormalizedEmbedding.FromArray(array));
    }
}
