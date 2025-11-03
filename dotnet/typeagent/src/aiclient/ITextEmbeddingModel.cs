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
        Action<BatchProgress>? progress = null,
        CancellationToken cancellationToken = default
    )
    {
        batchSize = Math.Min(batchSize, model.MaxBatchSize);
        if (batchSize > 1)
        {
            List<List<string>> chunks = [.. texts.GetStringChunks(batchSize, maxCharsPerChunk)];
            int rawCompleted = 0;
            Action<BatchProgress>? notifyProgress = progress is null
                ? null
                : (batch) =>
                {
                    rawCompleted += chunks[batch.CountCompleted - 1].Count;
                    progress(new BatchProgress(rawCompleted, texts.Count));
                };

            var embeddingChunks = await chunks.MapAsync(
                concurrency,
                model.GenerateAsync,
                notifyProgress,
                cancellationToken
            ).ConfigureAwait(false);

            return embeddingChunks.Flat();
        }
        else
        {
            return await texts.MapAsync(
                concurrency,
                model.GenerateAsync,
                progress,
                cancellationToken
                ).ConfigureAwait(false);
        }
    }
}
