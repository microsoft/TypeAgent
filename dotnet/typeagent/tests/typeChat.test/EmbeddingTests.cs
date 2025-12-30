// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TypeAgent.Vector;

namespace Microsoft.TypeChat.Tests;

public class EmbeddingTests
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

    [Fact]
    public void Constructor_WithValidVector_CreatesEmbedding()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);

        // Act
        var embedding = new Embedding(vector);

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
        Assert.Throws<ArgumentNullException>(() => new Embedding(vector));
    }

    [Fact]
    public void Empty_ReturnsEmptyEmbedding()
    {
        // Act
        var empty = Embedding.Empty;

        // Assert
        Assert.NotNull(empty.Vector);
        Assert.Equal(0, empty.Length);
    }

    [Fact]
    public void Length_ReturnsVectorLength()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f, 4.0f, 5.0f);
        var embedding = new Embedding(vector);

        // Act
        var length = embedding.Length;

        // Assert
        Assert.Equal(5, length);
    }

    [Fact]
    public void AsSpan_ReturnsReadOnlySpan()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);
        var embedding = new Embedding(vector);

        // Act
        var span = embedding.AsSpan();

        // Assert
        Assert.Equal(3, span.Length);
        Assert.Equal(1.0f, span[0]);
        Assert.Equal(2.0f, span[1]);
        Assert.Equal(3.0f, span[2]);
    }

    [Fact]
    public void CosineSimilarity_WithIdenticalVectors_ReturnsOne()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);
        var embedding1 = new Embedding(vector);
        var embedding2 = new Embedding(vector);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.Equal(1.0, similarity, precision: 5);
    }

    [Fact]
    public void CosineSimilarity_WithOrthogonalVectors_ReturnsZero()
    {
        // Arrange
        var vector1 = CreateTestVector(1.0f, 0.0f);
        var vector2 = CreateTestVector(0.0f, 1.0f);
        var embedding1 = new Embedding(vector1);
        var embedding2 = new Embedding(vector2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.Equal(0.0, similarity, precision: 5);
    }

    [Fact]
    public void CosineSimilarity_WithOppositeVectors_ReturnsNegativeOne()
    {
        // Arrange
        var vector1 = CreateTestVector(1.0f, 2.0f, 3.0f);
        var vector2 = CreateTestVector(-1.0f, -2.0f, -3.0f);
        var embedding1 = new Embedding(vector1);
        var embedding2 = new Embedding(vector2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.Equal(-1.0, similarity, precision: 5);
    }

    [Fact]
    public void CosineSimilarity_WithSpan_CalculatesCorrectly()
    {
        // Arrange
        var vector1 = CreateTestVector(1.0f, 2.0f, 3.0f);
        var vector2 = CreateTestVector(1.0f, 2.0f, 3.0f);
        var embedding = new Embedding(vector1);

        // Act
        var similarity = embedding.CosineSimilarity(vector2.AsSpan());

        // Assert
        Assert.Equal(1.0, similarity, precision: 5);
    }

    [Fact]
    public void DotProduct_WithVectors_CalculatesCorrectly()
    {
        // Arrange
        var vector1 = CreateTestVector(1.0f, 2.0f, 3.0f);
        var vector2 = CreateTestVector(4.0f, 5.0f, 6.0f);
        var embedding1 = new Embedding(vector1);
        var embedding2 = new Embedding(vector2);

        // Act
        var dotProduct = embedding1.DotProduct(embedding2);

        // Assert
        // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
        Assert.Equal(32.0, dotProduct, precision: 5);
    }

    [Fact]
    public void DotProduct_WithZeroVector_ReturnsZero()
    {
        // Arrange
        var vector1 = CreateTestVector(1.0f, 2.0f, 3.0f);
        var vector2 = CreateTestVector(0.0f, 0.0f, 0.0f);
        var embedding1 = new Embedding(vector1);
        var embedding2 = new Embedding(vector2);

        // Act
        var dotProduct = embedding1.DotProduct(embedding2);

        // Assert
        Assert.Equal(0.0, dotProduct);
    }

    [Fact]
    public void ToNormalized_CreatesNormalizedEmbedding()
    {
        // Arrange
        var vector = CreateTestVector(3.0f, 4.0f); // Length = 5
        var embedding = new Embedding(vector);

        // Act
        var normalized = embedding.ToNormalized();

        // Assert
        Assert.NotNull(normalized.Vector);
        Assert.Equal(2, normalized.Length);
        Assert.Equal(0.6f, normalized.Vector[0], precision: 5);
        Assert.Equal(0.8f, normalized.Vector[1], precision: 5);
    }

    [Fact]
    public void ToNormalized_DoesNotModifyOriginal()
    {
        // Arrange
        var vector = CreateTestVector(3.0f, 4.0f);
        var embedding = new Embedding(vector);
        var originalValues = vector.ToArray();

        // Act
        var normalized = embedding.ToNormalized();

        // Assert
        Assert.Equal(originalValues, embedding.Vector);
    }

    [Fact]
    public void NormalizeInPlace_ModifiesVectorInPlace()
    {
        // Arrange
        var vector = CreateTestVector(3.0f, 4.0f); // Length = 5
        var embedding = new Embedding(vector);

        // Act
        embedding.NormalizeInPlace();

        // Assert
        Assert.Equal(0.6f, embedding.Vector[0], precision: 5);
        Assert.Equal(0.8f, embedding.Vector[1], precision: 5);
    }

    [Fact]
    public void ToBytes_ConvertsVectorToBytes()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);
        var embedding = new Embedding(vector);

        // Act
        var bytes = embedding.ToBytes();

        // Assert
        Assert.NotNull(bytes);
        Assert.Equal(vector.Length * sizeof(float), bytes.Length);
    }

    [Fact]
    public void ToBytes_Static_ConvertsVectorToBytes()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);

        // Act
        var bytes = Embedding.ToBytes(vector);

        // Assert
        Assert.NotNull(bytes);
        Assert.Equal(vector.Length * sizeof(float), bytes.Length);
    }

    [Fact]
    public void FromBytes_ReconstructsVector()
    {
        // Arrange
        var originalVector = CreateTestVector(1.0f, 2.0f, 3.0f);
        var bytes = Embedding.ToBytes(originalVector);

        // Act
        var reconstructedVector = Embedding.FromBytes(bytes);

        // Assert
        Assert.NotNull(reconstructedVector);
        Assert.Equal(originalVector.Length, reconstructedVector.Length);
        Assert.Equal(originalVector, reconstructedVector);
    }

    [Fact]
    public void ToBytes_FromBytes_RoundTrip_PreservesData()
    {
        // Arrange
        var vector = CreateRandomVector(128, seed: 42);
        var embedding = new Embedding(vector);

        // Act
        var bytes = embedding.ToBytes();
        var reconstructed = Embedding.FromBytes(bytes);

        // Assert
        Assert.Equal(vector, reconstructed);
    }

    [Fact]
    public void ImplicitConversion_ToFloatArray_Works()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);
        var embedding = new Embedding(vector);

        // Act
        float[] convertedArray = embedding;

        // Assert
        Assert.Equal(vector, convertedArray);
    }

    [Fact]
    public void ImplicitConversion_FromFloatArray_Works()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);

        // Act
        Embedding embedding = vector;

        // Assert
        Assert.Equal(vector, embedding.Vector);
    }

    [Fact]
    public void ImplicitConversion_ToReadOnlySpan_Works()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);
        var embedding = new Embedding(vector);

        // Act
        ReadOnlySpan<float> span = embedding;

        // Assert
        Assert.Equal(3, span.Length);
        Assert.Equal(1.0f, span[0]);
        Assert.Equal(2.0f, span[1]);
        Assert.Equal(3.0f, span[2]);
    }

    [Fact]
    public void CosineSimilarity_WithSimilarVectors_ReturnsHighSimilarity()
    {
        // Arrange
        var vector1 = CreateTestVector(1.0f, 2.0f, 3.0f);
        var vector2 = CreateTestVector(1.1f, 2.1f, 3.1f);
        var embedding1 = new Embedding(vector1);
        var embedding2 = new Embedding(vector2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.True(similarity > 0.99, $"Expected similarity > 0.99, but got {similarity}");
    }

    [Fact]
    public void CosineSimilarity_WithDifferentVectors_ReturnsLowSimilarity()
    {
        // Arrange
        var vector1 = CreateTestVector(1.0f, 0.0f, 0.0f);
        var vector2 = CreateTestVector(0.0f, 0.0f, 1.0f);
        var embedding1 = new Embedding(vector1);
        var embedding2 = new Embedding(vector2);

        // Act
        var similarity = embedding1.CosineSimilarity(embedding2);

        // Assert
        Assert.True(similarity < 0.1, $"Expected similarity < 0.1, but got {similarity}");
    }

    [Fact]
    public void Vector_Property_ReturnsOriginalVector()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 2.0f, 3.0f);

        // Act
        var embedding = new Embedding(vector);

        // Assert
        Assert.Same(vector, embedding.Vector);
    }

    [Fact]
    public void NormalizeInPlace_WithUnitVector_RemainsUnchanged()
    {
        // Arrange
        var vector = CreateTestVector(1.0f, 0.0f, 0.0f); // Already unit vector
        var embedding = new Embedding(vector);

        // Act
        embedding.NormalizeInPlace();

        // Assert
        Assert.Equal(1.0f, embedding.Vector[0], precision: 5);
        Assert.Equal(0.0f, embedding.Vector[1], precision: 5);
        Assert.Equal(0.0f, embedding.Vector[2], precision: 5);
    }

    [Fact]
    public void ToNormalized_WithLargeVector_WorksCorrectly()
    {
        // Arrange
        var vector = CreateRandomVector(1536, seed: 100); // Common embedding size
        var embedding = new Embedding(vector);

        // Act
        var normalized = embedding.ToNormalized();

        // Assert
        Assert.Equal(1536, normalized.Length);
        // Verify it's normalized by checking the L2 norm is approximately 1
        var sumOfSquares = normalized.Vector.Sum(x => x * x);
        Assert.Equal(1.0, sumOfSquares, precision: 4);
    }
}
