// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class MessageTextIndexSettings
{
    public MessageTextIndexSettings(TextEmbeddingIndexSettings? embeddingIndexSetting = null)
    {
        EmbeddingIndexSettings = embeddingIndexSetting;
    }

    /// <summary>
    /// If you wan fuzzy message index with embeddings
    /// </summary>
    public TextEmbeddingIndexSettings? EmbeddingIndexSettings { get; set; }

    public int BatchSize { get; set; } = 8;

    public void ThrowIfInvalid()
    {
        ArgumentVerify.ThrowIfLessThan(BatchSize, 1, nameof(BatchSize));
    }
}
