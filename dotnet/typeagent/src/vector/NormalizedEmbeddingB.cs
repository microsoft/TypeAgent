// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

/// <summary>
/// A Normalized Embedding that can use a byte[] as a backing store
/// </summary>
public readonly struct NormalizedEmbeddingB
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
    public double CosineSimilarity(ReadOnlySpan<float> other)
    {
        // Since the embedding is normalized already
        return TensorPrimitives.Dot(this, other);
    }

    /// <summary>
    /// The Dot Product of this vector with the other embedding
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>dot product</returns>
    public double DotProduct(NormalizedEmbeddingB other)
    {
        return TensorPrimitives.Dot(this, other);
    }

    /// <summary>
    /// The Dot Product of this vector with the other embedding
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>dot product</returns>
    public double DotProduct(ReadOnlySpan<float> other)
    {
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
