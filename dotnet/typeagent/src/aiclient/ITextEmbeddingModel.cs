// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public interface ITextEmbeddingModel
{
    int MaxBatchSize { get; }

    Task<float[]> GenerateAsync(string input, CancellationToken cancellationToken);

    Task<IList<float[]>> GenerateAsync(IList<string> inputs, CancellationToken cancellationToken);
}

public static class TextEmbeddingModelExtensions
{
    /// <summary>
    /// Generate embeddings in parallel.
    /// Uses batching if the model supports it.
    /// </summary>
    /// <param name="model">The embedding model.</param>
    /// <param name="valueList">Strings for which to generate embeddings.</param>
    /// <param name="maxCharsPerChunk">Models can limit the total number of characters per batch.</param>
    /// <param name="concurrency">Degree of parallelism. Default is 1.</param>
    /// <returns></returns>
    public static async Task<List<float[]>> GenerateInBatchesAsync(
        this ITextEmbeddingModel model,
        IList<string> valueList,
        int maxCharsPerChunk,
        int concurrency = 2,
        CancellationToken cancellationToken = default
    )
    {
        if (model.MaxBatchSize > 1)
        {
            List<List<string>> chunks = [.. valueList.GetStringChunks(model.MaxBatchSize, maxCharsPerChunk)];
            var embeddingChunks = await chunks.MapAsync(
                concurrency,
                (chunk) => model.GenerateAsync(chunk, cancellationToken),
                cancellationToken
            );

            return embeddingChunks.Flat();
        }
        else
        {
            return await valueList.MapAsync(
                concurrency,
                (value) => model.GenerateAsync(value, cancellationToken),
                cancellationToken
                );
        }
    }
}
