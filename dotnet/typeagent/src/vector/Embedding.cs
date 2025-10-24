// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

/// <summary>
/// A lightweight struct that wraps an embedding vector
/// </summary>
public readonly struct Embedding
{
    /// <summary>
    /// Embedding using the given vector. Normalizes the vector before storing it
    /// </summary>
    /// <param name="vector">vector to create embedding from</param>
    [JsonConstructor]
    public Embedding(float[] vector)
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

    [JsonIgnore]
    public ReadOnlySpan<float> VectorSpan => Vector.AsSpan();

    /// <summary>
    /// Compute the cosine similarity between this and other
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>cosine similarity</returns>
    public double CosineSimilarity(Embedding other)
    {
        return VectorOp.CosineSimilarity(Vector, other.Vector);
    }

    /// <summary>
    /// The Dot Product of this vector with the other embedding
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>dot product</returns>
    public double DotProduct(Embedding other)
    {
        return VectorOp.DotProduct(Vector, other.Vector);
    }

    public NormalizedEmbedding Normalize()
    {
        float[] normalized = new float[Vector.Length];
        Vector.AsSpan().CopyTo(normalized);
        VectorOp.NormalizeInPlace(normalized);
        return new NormalizedEmbedding(normalized);
    }

    public static implicit operator float[](Embedding vector)
    {
        return vector.Vector;
    }

    public static implicit operator Embedding(float[] vector)
    {
        return new Embedding(vector);
    }
}

