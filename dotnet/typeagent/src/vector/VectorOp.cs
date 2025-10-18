// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

public static class VectorOp
{
    private static double EuclideanLength(float[] vector)
    {
        return Math.Sqrt(TensorPrimitives.Dot(vector, vector));
    }

    /// <summary>
    /// Makes this embedding into a unit vector - in place
    /// If all embeddings have length 1, you can use DotProducts into of full Cosine Similarity. 
    /// </summary>
    public static void NormalizeInPlace(float[] vector)
    {
        var length = EuclideanLength(vector);
        for (int i = 0; i < vector.Length; ++i)
        {
            vector[i] = (float)((double)vector[i] / length);
        }
    }

    /// <summary>
    /// The Dot Product of this vector with the
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>dot product</returns>
    public static double DotProduct(float[] x, float[] y)
    {
        // Delegate error checking
        return TensorPrimitives.Dot(x, y);
    }


    /// <summary>
    /// Compute the cosine similarity between this and other
    /// </summary>
    /// <param name="other">other embedding</param>
    /// <returns>cosine similarity</returns>
    public static double CosineSimilarity(float[] x, float[] y)
    {
        // Delegate error checking
        return TensorPrimitives.CosineSimilarity(x, y);
    }
}
