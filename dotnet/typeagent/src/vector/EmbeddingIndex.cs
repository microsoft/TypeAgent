// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

public interface IEmbeddingIndex<T> where T : ICosineSimilarity<T>
{
    void Add(T embedding);
}

public class EmbeddingIndex<T> : List<T>
    where T : ICosineSimilarity<T>
{
    public EmbeddingIndex()
    {
    }
}
