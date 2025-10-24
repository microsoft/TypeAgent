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

    public ReadOnlySpan<float> AsSpan() => Vector.AsSpan();

    /// <summary>
    /// Compute the cosine similarity between this and other
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>cosine similarity</returns>
    public double CosineSimilarity(Embedding other)
    {
        return TensorPrimitives.CosineSimilarity(this, other);
    }

    /// <summary>
    /// Compute the cosine similarity between this and other
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>cosine similarity</returns>
    public double CosineSimilarity(ReadOnlySpan<float> other)
    {
        return TensorPrimitives.CosineSimilarity(this, other);
    }

    /// <summary>
    /// The Dot Product of this vector with the other embedding
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>dot product</returns>
    public double DotProduct(Embedding other)
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

    public NormalizedEmbedding ToNormalized()
    {
        float[] normalized = new float[Vector.Length];
        Vector.AsSpan().CopyTo(normalized);
        var l2Norm = TensorPrimitives.Norm(normalized);
        TensorPrimitives.Divide(normalized, l2Norm, normalized);
        return new NormalizedEmbedding(normalized);
    }

    public void NormalizeInPlace()
    {
        var l2Norm = TensorPrimitives.Norm(this);
        TensorPrimitives.Divide(this, l2Norm, Vector);
    }

    public byte[] ToBytes() => ToBytes(Vector);

    public static byte[] ToBytes(float[] vector)
    {
        var bytes = new byte[vector.Length * sizeof(float)];
        Buffer.BlockCopy(vector, 0, bytes, 0, bytes.Length);
        return bytes;
    }

    public static float[] FromBytes(byte[] bytes)
    {
        var floats = new float[bytes.Length / sizeof(float)];
        Buffer.BlockCopy(bytes, 0, floats, 0, bytes.Length);
        return floats;
    }

    public static implicit operator float[](Embedding vector)
    {
        return vector.Vector;
    }

    public static implicit operator Embedding(float[] vector)
    {
        return new Embedding(vector);
    }

    public static implicit operator ReadOnlySpan<float>(Embedding embedding)
    {
        return embedding.AsSpan();
    }
}

