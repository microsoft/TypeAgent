// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.Vector;

namespace Microsoft.TypeChat.Tests;

public class NormalizedEmbeddingBTests
{
    private static float[] CreateTestVector(params float[] values)
    {
        return values;
    }

    private static float[] CreateRandomVector(int length, int seed = 0)
    {
        var random = new Random(seed);
        var vector = new float[length];
        for (int i = 0; i < length; i++)
        {
            vector[i] = (float)random.NextDouble();
        }
        return vector;
    }

    private static float[] CreateNormalizedVector(params float[] values)
    {
        var sumOfSquares = values.Sum(x => x * x);
        var magnitude = MathF.Sqrt(sumOfSquares);
        return values.Select(x => x / magnitude).ToArray();
    }

    [Fact]
    public void Constructor_WithValidByteArray_CreatesNormalizedEmbeddingB()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(vector);

        // Act
        var embedding = new NormalizedEmbeddingB(bytes);

        // Assert
        Assert.NotNull(embedding.Vector);
        Assert.Equal(12, embedding.Length); // 3 floats * 4 bytes
        Assert.Equal(bytes, embedding.Vector);
    }

    [Fact]
    public void Constructor_WithNullByteArray_ThrowsArgumentNullException()
    {
        // Arrange
        byte[] bytes = null;

        // Act & Assert
        Assert.Throws<ArgumentNullException>(() => new NormalizedEmbeddingB(bytes));
    }

    [Fact]
    public void Length_ReturnsVectorLength()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f, 4.0f, 5.0f);
        var bytes = Embedding.ToBytes(vector);
        var embedding = new NormalizedEmbeddingB(bytes);

        // Act
        var length = embedding.Length;

        // Assert
        Assert.Equal(20, length); // 5 floats * 4 bytes
    }

    [Fact]
    public void AsSpan_ReturnsReadOnlySpanOfFloats()
    {
        // Arrange
        var vector = CreateTestVector(0.6f, 0.8f);
        var bytes = Embedding.ToBytes(vector);
        var embedding = new NormalizedEmbeddingB(bytes);

        // Act
        var span = embedding.AsSpan();

        // Assert
        Assert.Equal(2, span.Length);
        Assert.Equal(0.6f, span[0]);
        Assert.Equal(0.8f, span[1]);
    }

    [Fact]
    public void ToEmbedding_ConvertsToEmbedding()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(vector);
        var embeddingB = new NormalizedEmbeddingB(bytes);

        // Act
        var embedding = embeddingB.ToEmbedding();

        // Assert
        Assert.Equal(3, embedding.Length);
        Assert.Equal(vector[0], embedding.Vector[0]);
        Assert.Equal(vector[1], embedding.Vector[1]);
        Assert.Equal(vector[2], embedding.Vector[2]);
    }

    [Fact]
    public void CosineSimilarity_WithIdenticalNormalizedEmbeddingB_ReturnsOne()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(vector);
        var embedding1 = new NormalizedEmbeddingB(bytes);
        var embedding2 = new NormalizedEmbeddingB(bytes);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.Equal(1.0, similarity, precision: 5);
    }

    [Fact]
    public void CosineSimilarity_WithOrthogonalVectors_ReturnsZero()
    {
        // Arrange
        var vector1 = CreateNormalizedVector(1.0f, 0.0f);
        var vector2 = CreateNormalizedVector(0.0f, 1.0f);
        var bytes1 = Embedding.ToBytes(vector1);
        var bytes2 = Embedding.ToBytes(vector2);
        var embedding1 = new NormalizedEmbeddingB(bytes1);
        var embedding2 = new NormalizedEmbeddingB(bytes2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.Equal(0.0, similarity, precision: 5);
    }

    [Fact]
    public void CosineSimilarity_WithOppositeVectors_ReturnsNegativeOne()
    {
        // Arrange
        var vector1 = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var vector2 = CreateNormalizedVector(-1.0f, -2.0f, -3.0f);
        var bytes1 = Embedding.ToBytes(vector1);
        var bytes2 = Embedding.ToBytes(vector2);
        var embedding1 = new NormalizedEmbeddingB(bytes1);
        var embedding2 = new NormalizedEmbeddingB(bytes2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.Equal(-1.0, similarity, precision: 5);
    }

    [Fact]
    public void CosineSimilarity_WithNormalizedEmbedding_CalculatesCorrectly()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(vector);
        var embeddingB = new NormalizedEmbeddingB(bytes);
        var embedding = new NormalizedEmbedding(vector);

        // Act
        var similarity = embeddingB.CosineSimilarity(embedding);

        // Assert
        Assert.Equal(1.0, similarity, precision: 5);
    }

    [Fact]
    public void CosineSimilarity_BetweenNormalizedEmbeddingBAndNormalizedEmbedding_IsSymmetric()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(vector);
        var embeddingB = new NormalizedEmbeddingB(bytes);
        var embedding = new NormalizedEmbedding(vector);

        // Act
        var similarity1 = embeddingB.CosineSimilarity(embedding);
        var similarity2 = embedding.CosineSimilarity(embeddingB);

        // Assert
        Assert.Equal(similarity1, similarity2, precision: 10);
    }

    [Fact]
    public void CosineSimilarity_UsesOptimizedDotProduct()
    {
        // Arrange - normalized vectors, so cosine similarity = dot product
        var vector1 = CreateNormalizedVector(3.0f, 4.0f);
        var vector2 = CreateNormalizedVector(5.0f, 12.0f);
        var bytes1 = Embedding.ToBytes(vector1);
        var bytes2 = Embedding.ToBytes(vector2);
        var embedding1 = new NormalizedEmbeddingB(bytes1);
        var embedding2 = new NormalizedEmbeddingB(bytes2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        // For normalized vectors: (0.6, 0.8) · (0.3846..., 0.9230...) ≈ 0.9692
        Assert.True(similarity > 0.95 && similarity < 1.0);
    }

    [Fact]
    public void ImplicitConversion_ToByteArray_Works()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(vector);
        var embedding = new NormalizedEmbeddingB(bytes);

        // Act
        byte[] convertedArray = embedding;

        // Assert
        Assert.Equal(bytes, convertedArray);
    }

    [Fact]
    public void ImplicitConversion_ToReadOnlySpan_Works()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(vector);
        var embedding = new NormalizedEmbeddingB(bytes);

        // Act
        ReadOnlySpan<float> span = embedding;

        // Assert
        Assert.Equal(3, span.Length);
        Assert.Equal(vector[0], span[0], precision: 5);
        Assert.Equal(vector[1], span[1], precision: 5);
        Assert.Equal(vector[2], span[2], precision: 5);
    }

    [Fact]
    public void Vector_Property_ReturnsOriginalByteArray()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(vector);

        // Act
        var embedding = new NormalizedEmbeddingB(bytes);

        // Assert
        Assert.Same(bytes, embedding.Vector);
    }

    [Fact]
    public void CosineSimilarity_WithSimilarVectors_ReturnsHighSimilarity()
    {
        // Arrange
        var vector1 = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var vector2 = CreateNormalizedVector(1.1f, 2.1f, 3.1f);
        var bytes1 = Embedding.ToBytes(vector1);
        var bytes2 = Embedding.ToBytes(vector2);
        var embedding1 = new NormalizedEmbeddingB(bytes1);
        var embedding2 = new NormalizedEmbeddingB(bytes2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.True(similarity > 0.99, $"Expected similarity > 0.99, but got {similarity}");
    }

    [Fact]
    public void CosineSimilarity_WithDifferentVectors_ReturnsLowSimilarity()
    {
        // Arrange
        var vector1 = CreateNormalizedVector(1.0f, 0.0f, 0.0f);
        var vector2 = CreateNormalizedVector(0.0f, 0.0f, 1.0f);
        var bytes1 = Embedding.ToBytes(vector1);
        var bytes2 = Embedding.ToBytes(vector2);
        var embedding1 = new NormalizedEmbeddingB(bytes1);
        var embedding2 = new NormalizedEmbeddingB(bytes2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.True(similarity < 0.1, $"Expected similarity < 0.1, but got {similarity}");
    }

    [Fact]
    public void ToEmbedding_FromBytes_RoundTrip_PreservesData()
    {
        // Arrange
        var vector = CreateRandomVector(128, seed: 42);
        var bytes = Embedding.ToBytes(vector);
        var embeddingB = new NormalizedEmbeddingB(bytes);

        // Act
        var embedding = embeddingB.ToEmbedding();
        var reconstructedBytes = embedding.ToBytes();

        // Assert
        Assert.Equal(bytes, reconstructedBytes);
    }

    [Fact]
    public void AsSpan_CanBeUsedInCalculations()
    {
        // Arrange
        var vector1 = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var vector2 = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(vector1);
        var embedding = new NormalizedEmbeddingB(bytes);

        // Act
        var span = embedding.AsSpan();
        var dotProduct = 0.0f;
        for (int i = 0; i < span.Length; i++)
        {
            dotProduct += span[i] * vector2[i];
        }

        // Assert
        Assert.Equal(1.0, dotProduct, precision: 5);
    }

    [Fact]
    public void Constructor_WithLargeVector_WorksCorrectly()
    {
        // Arrange
        var vector = CreateRandomVector(1536, seed: 100); // Common embedding size
        var bytes = Embedding.ToBytes(vector);

        // Act
        var embedding = new NormalizedEmbeddingB(bytes);

        // Assert
        Assert.Equal(6144, embedding.Length); // 1536 floats * 4 bytes
        var span = embedding.AsSpan();
        Assert.Equal(1536, span.Length);
    }

    [Fact]
    public void ToEmbedding_WithLargeVector_PreservesAllValues()
    {
        // Arrange
        var vector = CreateRandomVector(1536, seed: 200);
        var bytes = Embedding.ToBytes(vector);
        var embeddingB = new NormalizedEmbeddingB(bytes);

        // Act
        var embedding = embeddingB.ToEmbedding();

        // Assert
        Assert.Equal(vector.Length, embedding.Length);
        for (int i = 0; i < vector.Length; i++)
        {
            Assert.Equal(vector[i], embedding.Vector[i], precision: 5);
        }
    }

    [Fact]
    public void AsSpan_MultipleCallsReturnSameData()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(vector);
        var embedding = new NormalizedEmbeddingB(bytes);

        // Act
        var span1 = embedding.AsSpan();
        var span2 = embedding.AsSpan();

        // Assert
        Assert.Equal(span1.Length, span2.Length);
        for (int i = 0; i < span1.Length; i++)
        {
            Assert.Equal(span1[i], span2[i]);
        }
    }

    [Fact]
    public void CosineSimilarity_WithEmptyVectors_HandlesGracefully()
    {
        // Arrange
        var vector = CreateTestVector();
        var bytes = Embedding.ToBytes(vector);
        var embedding1 = new NormalizedEmbeddingB(bytes);
        var embedding2 = new NormalizedEmbeddingB(bytes);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.Equal(0.0, similarity);
    }

    [Fact]
    public void NormalizedEmbeddingB_StoresDataAsByteArray()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(vector);

        // Act
        var embedding = new NormalizedEmbeddingB(bytes);

        // Assert
        Assert.IsType<byte[]>(embedding.Vector);
        Assert.Equal(bytes.Length, embedding.Vector.Length);
    }

    [Fact]
    public void CosineSimilarity_IsCommutative()
    {
        // Arrange
        var vector1 = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var vector2 = CreateNormalizedVector(4.0f, 5.0f, 6.0f);
        var bytes1 = Embedding.ToBytes(vector1);
        var bytes2 = Embedding.ToBytes(vector2);
        var embedding1 = new NormalizedEmbeddingB(bytes1);
        var embedding2 = new NormalizedEmbeddingB(bytes2);

        // Act
        var similarity1to2 = embedding1.CosineSimilarity(embedding2);
        var similarity2to1 = embedding2.CosineSimilarity(embedding1);

        // Assert
        Assert.Equal(similarity1to2, similarity2to1, precision: 10);
    }
}
