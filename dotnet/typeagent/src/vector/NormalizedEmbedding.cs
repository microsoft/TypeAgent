// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

/// <summary>
/// A lightweight struct that wraps a Normalized (unit length) embedding vector
/// </summary>
public readonly struct NormalizedEmbedding
{
    /// <summary>
    /// Embedding using the given vector. Normalizes the vector before storing it
    /// </summary>
    /// <param name="vector">vector to create embedding from</param>
    [JsonConstructor]
    public NormalizedEmbedding(float[] vector)
    {
        ArgumentVerify.ThrowIfNull(vector, nameof(vector));
        Vector = vector;
    }

    [JsonIgnore]
    public int Length => Vector.Length;

    /// <summary>
    /// The raw embedding vector
    /// </summary>
    public float[] Vector { get; }

    public ReadOnlySpan<float> AsSpan() => Vector.AsSpan();

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

    /// <summary>
    /// The Dot Product of this vector with the other embedding
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>dot product</returns>
    public double DotProduct(NormalizedEmbedding other)
    {
        return TensorPrimitives.Dot(this, other);
    }

    public byte[] ToBytes()
    {
        return Embedding.ToBytes(Vector);
    }

    public static NormalizedEmbedding FromArray(float[] array, bool normalize = true)
    {
        if (normalize)
        {
            Embedding embedding = array;
            embedding.NormalizeInPlace();
            return new NormalizedEmbedding(embedding);
        }
        else
        {
            return new NormalizedEmbedding(array);
        }
    }

    public static implicit operator float[](NormalizedEmbedding embedding)
    {
        return embedding.Vector;
    }

    public static implicit operator ReadOnlySpan<float>(NormalizedEmbedding embedding)
    {
        return embedding.AsSpan();
    }
}

