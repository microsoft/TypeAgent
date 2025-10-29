// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public interface ITextEmbeddingModel
{
    int MaxBatchSize { get; }

    Task<float[]> GenerateAsync(string text, CancellationToken cancellationToken);

    // TODO: take IReadOnlyList as input
    Task<IList<float[]>> GenerateAsync(IList<string> texts, CancellationToken cancellationToken);
}

public static class TextEmbeddingModelExtensions
{
    // TODO: take IReadOnlyList as input

    /// <summary>
    /// Generate embeddings in parallel.
    /// Uses batching if the model supports it.
    /// </summary>
    /// <param name="model">The embedding model.</param>
    /// <param name="texts">Strings for which to generate embeddings.</param>
    /// <param name="maxCharsPerChunk">Models can limit the total number of characters per batch.</param>
    /// <param name="concurrency">Degree of parallelism. Default is 1.</param>
    /// <returns></returns>
    public static async Task<List<float[]>> GenerateInBatchesAsync(
        this ITextEmbeddingModel model,
        IList<string> texts,
        int batchSize,
        int maxCharsPerChunk,
        int concurrency = 1,
        Action<BatchItem<string>>? progress = null,
        CancellationToken cancellationToken = default
    )
    {
        batchSize = Math.Min(batchSize, model.MaxBatchSize);
        if (batchSize > 1)
        {
            List<List<string>> chunks = [.. texts.GetStringChunks(batchSize, maxCharsPerChunk)];

            Action<BatchItem<List<string>>, IList<float[]>>? batchProgress = progress is not null
                ? (batch, _) => Progress.Notify(progress, texts.Count, batch)
                : null;

            var embeddingChunks = await chunks.MapAsync(
                concurrency,
                (chunk) => Async.CallWithRetryAsync((ct) => model.GenerateAsync(chunk, ct), cancellationToken),
                batchProgress,
                cancellationToken
            ).ConfigureAwait(false);

            return embeddingChunks.Flat();
        }
        else
        {
            Action<BatchItem<string>, float[]>? batchProgress = progress is not null
                ? (batch, _) => progress(batch)
                : null;

            return await texts.MapAsync(
                concurrency,
                (value) => model.GenerateAsync(value, cancellationToken),
                batchProgress,
                cancellationToken
                ).ConfigureAwait(false);
        }
    }
}
