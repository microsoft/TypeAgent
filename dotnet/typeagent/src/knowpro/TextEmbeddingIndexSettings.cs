// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class TextEmbeddingIndexSettings
{
    public TextEmbeddingIndexSettings(
        ITextEmbeddingModel model,
        int embeddingSize,
        double minScore = 0.85,
        int maxMatches = -1
    )
    {
        EmbeddingModel = model;
        EmbeddingSize = embeddingSize;
        MinScore = minScore;
        MaxMatches = maxMatches;
        BatchSize = 8;

        Retry = new RetrySettings()
        {
            MaxRetries = 2,
            RetryPauseMs = 2000,
        };
        ThrowIfInvalid();
    }

    public ITextEmbeddingModel EmbeddingModel { get; set; }

    public int EmbeddingSize { get; set; }

    public double MinScore { get; set; }

    public int MaxMatches { get; set; }

    public int BatchSize { get; set; }

    public RetrySettings Retry { get; set; }

    public void ThrowIfInvalid()
    {
        ArgumentVerify.ThrowIfNull(EmbeddingModel, nameof(EmbeddingModel));
        ArgumentVerify.ThrowIfLessThan(EmbeddingSize, 1, nameof(EmbeddingSize));
    }
}
