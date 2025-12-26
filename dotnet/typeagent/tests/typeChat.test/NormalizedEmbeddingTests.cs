// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.Vector;

namespace Microsoft.TypeChat.Tests;

public class NormalizedEmbeddingTests
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
    public void Constructor_WithValidVector_CreatesNormalizedEmbedding()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);

        // Act
        var embedding = new NormalizedEmbedding(vector);

        // Assert
        Assert.NotNull(embedding.Vector);
        Assert.Equal(3, embedding.Length);
        Assert.Equal(vector, embedding.Vector);
    }

    [Fact]
    public void Constructor_WithNullVector_ThrowsArgumentNullException()
    {
        // Arrange
        float[] vector = null;

        // Act & Assert
        Assert.Throws<ArgumentNullException>(() => new NormalizedEmbedding(vector));
    }

    [Fact]
    public void Length_ReturnsVectorLength()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f, 4.0f, 5.0f);
        var embedding = new NormalizedEmbedding(vector);

        // Act
        var length = embedding.Length;

        // Assert
        Assert.Equal(5, length);
    }

    [Fact]
    public void AsSpan_ReturnsReadOnlySpan()
    {
        // Arrange
        var vector = CreateTestVector(0.6f, 0.8f);
        var embedding = new NormalizedEmbedding(vector);

        // Act
        var span = embedding.AsSpan();

        // Assert
        Assert.Equal(2, span.Length);
        Assert.Equal(0.6f, span[0]);
        Assert.Equal(0.8f, span[1]);
    }

    [Fact]
    public void CosineSimilarity_WithIdenticalVectors_ReturnsOne()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var embedding1 = new NormalizedEmbedding(vector);
        var embedding2 = new NormalizedEmbedding(vector);

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
        var embedding1 = new NormalizedEmbedding(vector1);
        var embedding2 = new NormalizedEmbedding(vector2);

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
        var embedding1 = new NormalizedEmbedding(vector1);
        var embedding2 = new NormalizedEmbedding(vector2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.Equal(-1.0, similarity, precision: 5);
    }

    [Fact]
    public void CosineSimilarity_WithNormalizedEmbeddingB_CalculatesCorrectly()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var embedding = new NormalizedEmbedding(vector);
        var bytes = Embedding.ToBytes(vector);
        var embeddingB = new NormalizedEmbeddingB(bytes);

        // Act
        var similarity = embedding.CosineSimilarity(embeddingB);

        // Assert
        Assert.Equal(1.0, similarity, precision: 5);
    }

    [Fact]
    public void CosineSimilarity_UsesOptimizedDotProduct()
    {
        // Arrange - normalized vectors, so cosine similarity = dot product
        var vector1 = CreateNormalizedVector(3.0f, 4.0f);
        var vector2 = CreateNormalizedVector(5.0f, 12.0f);
        var embedding1 = new NormalizedEmbedding(vector1);
        var embedding2 = new NormalizedEmbedding(vector2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        // For normalized vectors: (0.6, 0.8) · (0.3846..., 0.9230...) ≈ 0.9692
        Assert.True(similarity > 0.95 && similarity < 1.0);
    }

    [Fact]
    public void ToBytes_ConvertsVectorToBytes()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var embedding = new NormalizedEmbedding(vector);

        // Act
        var bytes = embedding.ToBytes();

        // Assert
        Assert.NotNull(bytes);
        Assert.Equal(vector.Length * sizeof(float), bytes.Length);
    }

    [Fact]
    public void FromArray_WithNormalize_CreatesNormalizedEmbedding()
    {
        // Arrange
        var vector = CreateTestVector(3.0f, 4.0f); // Length = 5

        // Act
        var embedding = NormalizedEmbedding.FromArray(vector, normalize: true);

        // Assert
        Assert.NotNull(embedding.Vector);
        Assert.Equal(2, embedding.Length);
        Assert.Equal(0.6f, embedding.Vector[0], precision: 5);
        Assert.Equal(0.8f, embedding.Vector[1], precision: 5);
    }

    [Fact]
    public void FromArray_WithoutNormalize_CreatesEmbeddingWithOriginalVector()
    {
        // Arrange
        var vector = CreateTestVector(3.0f, 4.0f);

        // Act
        var embedding = NormalizedEmbedding.FromArray(vector, normalize: false);

        // Assert
        Assert.NotNull(embedding.Vector);
        Assert.Equal(2, embedding.Length);
        Assert.Equal(3.0f, embedding.Vector[0]);
        Assert.Equal(4.0f, embedding.Vector[1]);
    }

    [Fact]
    public void FromArray_DefaultParameter_NormalizesVector()
    {
        // Arrange
        var vector = CreateTestVector(3.0f, 4.0f);

        // Act
        var embedding = NormalizedEmbedding.FromArray(vector);

        // Assert
        Assert.Equal(0.6f, embedding.Vector[0], precision: 5);
        Assert.Equal(0.8f, embedding.Vector[1], precision: 5);
    }

    [Fact]
    public void ImplicitConversion_ToFloatArray_Works()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var embedding = new NormalizedEmbedding(vector);

        // Act
        float[] convertedArray = embedding;

        // Assert
        Assert.Equal(vector, convertedArray);
    }

    [Fact]
    public void ImplicitConversion_ToReadOnlySpan_Works()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var embedding = new NormalizedEmbedding(vector);

        // Act
        ReadOnlySpan<float> span = embedding;

        // Assert
        Assert.Equal(3, span.Length);
        Assert.Equal(vector[0], span[0], precision: 5);
        Assert.Equal(vector[1], span[1], precision: 5);
        Assert.Equal(vector[2], span[2], precision: 5);
    }

    [Fact]
    public void ToBytes_FromBytes_RoundTrip_PreservesData()
    {
        // Arrange
        var vector = CreateRandomVector(128, seed: 42);
        var embedding = NormalizedEmbedding.FromArray(vector, normalize: true);

        // Act
        var bytes = embedding.ToBytes();
        var reconstructed = Embedding.FromBytes(bytes);

        // Assert
        Assert.Equal(embedding.Vector, reconstructed);
    }

    [Fact]
    public void Vector_Property_ReturnsOriginalVector()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);

        // Act
        var embedding = new NormalizedEmbedding(vector);

        // Assert
        Assert.Same(vector, embedding.Vector);
    }

    [Fact]
    public void CosineSimilarity_WithSimilarVectors_ReturnsHighSimilarity()
    {
        // Arrange
        var vector1 = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var vector2 = CreateNormalizedVector(1.1f, 2.1f, 3.1f);
        var embedding1 = new NormalizedEmbedding(vector1);
        var embedding2 = new NormalizedEmbedding(vector2);

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
        var embedding1 = new NormalizedEmbedding(vector1);
        var embedding2 = new NormalizedEmbedding(vector2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.True(similarity < 0.1, $"Expected similarity < 0.1, but got {similarity}");
    }

    [Fact]
    public void FromArray_WithLargeVector_WorksCorrectly()
    {
        // Arrange
        var vector = CreateRandomVector(1536, seed: 100); // Common embedding size

        // Act
        var embedding = NormalizedEmbedding.FromArray(vector, normalize: true);

        // Assert
        Assert.Equal(1536, embedding.Length);
        // Verify it's normalized by checking the L2 norm is approximately 1
        var sumOfSquares = embedding.Vector.Sum(x => x * x);
        Assert.Equal(1.0, sumOfSquares, precision: 4);
    }

    [Fact]
    public void FromArray_WithZeroVector_HandlesGracefully()
    {
        // Arrange
        var vector = CreateTestVector(0.0f, 0.0f, 0.0f);

        // Act
        var embedding = NormalizedEmbedding.FromArray(vector, normalize: true);

        // Assert
        Assert.Equal(3, embedding.Length);
        // Normalization of zero vector results in NaN or Infinity
        Assert.True(float.IsNaN(embedding.Vector[0]) || float.IsInfinity(embedding.Vector[0]));
    }

    [Fact]
    public void CosineSimilarity_BetweenNormalizedAndNormalizedB_IsSymmetric()
    {
        // Arrange
        var vector = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var embedding = new NormalizedEmbedding(vector);
        var bytes = Embedding.ToBytes(vector);
        var embeddingB = new NormalizedEmbeddingB(bytes);

        // Act
        var similarity1 = embedding.CosineSimilarity(embeddingB);
        var similarity2 = embeddingB.CosineSimilarity(embedding);

        // Assert
        Assert.Equal(similarity1, similarity2, precision: 10);
    }

    [Fact]
    public void FromArray_WithUnitVector_RemainsUnchanged()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 0.0f, 0.0f); // Already unit vector

        // Act
        var embedding = NormalizedEmbedding.FromArray(vector, normalize: true);

        // Assert
        Assert.Equal(1.0f, embedding.Vector[0], precision: 5);
        Assert.Equal(0.0f, embedding.Vector[1], precision: 5);
        Assert.Equal(0.0f, embedding.Vector[2], precision: 5);
    }

    [Fact]
    public void AsSpan_CanBeUsedInCalculations()
    {
        // Arrange
        var vector1 = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var vector2 = CreateNormalizedVector(1.0f, 2.0f, 3.0f);
        var embedding = new NormalizedEmbedding(vector1);

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
    public void FromArray_WithEmptyVector_CreatesEmptyEmbedding()
    {
        // Arrange
        var vector = CreateTestVector();

        // Act
        var embedding = NormalizedEmbedding.FromArray(vector, normalize: false);

        // Assert
        Assert.Equal(0, embedding.Length);
        Assert.NotNull(embedding.Vector);
    }
}
