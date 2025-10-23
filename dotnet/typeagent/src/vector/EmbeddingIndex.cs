// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Vector;

public class EmbeddingIndex : List<NormalizedEmbedding>
{
    public EmbeddingIndex()
        : base()
    {
    }

    public EmbeddingIndex(int capacity)
        : base(capacity)
    {
    }
}
