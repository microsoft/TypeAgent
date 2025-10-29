// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

/// <summary>
/// A Normalized Embedding that can use a byte[] as a backing store
/// </summary>
public readonly struct NormalizedEmbeddingB :
    ICosineSimilarity<NormalizedEmbedding>,
    ICosineSimilarity<NormalizedEmbeddingB>
{
    public NormalizedEmbeddingB(byte[] vector)
    {
        ArgumentVerify.ThrowIfNull(vector, nameof(vector));
        Vector = vector;
    }

    [JsonIgnore]
    public int Length => Vector.Length;

    /// <summary>
    /// The raw embedding vector
    /// </summary>
    public byte[] Vector { get; }

    public ReadOnlySpan<float> AsSpan()
    {
        return MemoryMarshal.Cast<byte, float>(Vector);
    }

    public Embedding ToEmbedding()
    {
        return AsSpan().ToArray();
    }

    /// <summary>
    /// Compute the cosine similarity between this and other
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>cosine similarity</returns>
    public double CosineSimilarity(NormalizedEmbeddingB other)
    {
        // Since the embedding is normalized already
        return TensorPrimitives.Dot(this, other);
    }

    /// <summary>
    /// Compute the cosine similarity between this and other
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>cosine similarity</returns>
    public double CosineSimilarity(NormalizedEmbedding other)
    {
        // Since the embedding is normalized already
        return TensorPrimitives.Dot(this, other);
    }

    public static implicit operator byte[](NormalizedEmbeddingB embedding)
    {
        return embedding.Vector;
    }

    public static implicit operator ReadOnlySpan<float>(NormalizedEmbeddingB embedding)
    {
        return embedding.AsSpan();
    }
}
