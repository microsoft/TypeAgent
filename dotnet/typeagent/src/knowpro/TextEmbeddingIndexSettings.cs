// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class TextEmbeddingIndexSettings
{
    public TextEmbeddingIndexSettings(
        ITextEmbeddingModel model,
        double minScore = 0.85,
        int maxMatches = -1
    )
    {
        EmbeddingModel = model;
        MinScore = minScore;
        MaxMatches = maxMatches;
        MaxCharsPerBatch = 2048;
        BatchSize = 8;

        Retry = new RetrySettings()
        {
            MaxRetries = 2,
            RetryPauseMs = 2000,
        };
        ThrowIfInvalid();
    }

    public ITextEmbeddingModel EmbeddingModel { get; set; }

    public double MinScore { get; set; }

    public int MaxMatches { get; set; }

    public int MaxCharsPerBatch { get; set; }

    public int BatchSize { get; set; }

    public RetrySettings Retry { get; set; }

    public void ThrowIfInvalid()
    {
        ArgumentVerify.ThrowIfNull(EmbeddingModel, nameof(EmbeddingModel));
        ArgumentVerify.ThrowIfLessThan(MaxCharsPerBatch, 0, nameof(MaxCharsPerBatch));
    }
}
