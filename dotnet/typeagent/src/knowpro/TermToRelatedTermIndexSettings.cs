// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class TermToRelatedTermIndexSettings
{
    public TermToRelatedTermIndexSettings(TextEmbeddingIndexSettings? embeddingIndexSetting = null)
    {
        EmbeddingIndexSetting = embeddingIndexSetting;
    }

    /// <summary>
    /// Required if you want fuzzy indexing using embeddings
    /// </summary>
    public TextEmbeddingIndexSettings? EmbeddingIndexSetting { get; set; }
}
