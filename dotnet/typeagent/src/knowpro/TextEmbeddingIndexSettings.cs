// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

/// <summary>
/// Note: The default settings here are applicable only to Ada002
/// Currently, you will need to determine suitable ones for other models
/// </summary>
public class TextEmbeddingIndexSettings
{
    public TextEmbeddingIndexSettings(
        ITextEmbeddingModel model,
        double minScore,
        int maxMatches = -1
    )
    {
        EmbeddingModel = model;
        MinScore = minScore;
        MaxMatches = maxMatches;
        MaxCharsPerBatch = 2048;
        BatchSize = 8;
        Concurrency = 1;
        Retry = new RetrySettings()
        {
            MaxRetries = 2,
            RetryPauseMs = 2000,
        };
        ThrowIfInvalid();
    }

    public ITextEmbeddingModel EmbeddingModel { get; set; }

    /// <summary>
    /// Min score for matches. Min score reduces matching NOISE
    /// </summary>
    public double MinScore { get; set; }

    /// <summary>
    /// Default max number of matches the index returns
    /// Ignored if < 0
    /// </summary>
    public int MaxMatches { get; set; }

    public int MaxCharsPerBatch { get; set; }

    public int BatchSize { get; set; }

    public int Concurrency { get; set; }

    public RetrySettings Retry { get; set; }

    public void ThrowIfInvalid()
    {
        ArgumentVerify.ThrowIfNull(EmbeddingModel, nameof(EmbeddingModel));
        ArgumentVerify.ThrowIfLessThan(MaxCharsPerBatch, 0, nameof(MaxCharsPerBatch));
    }

    public static TextEmbeddingIndexSettings CreateForAda02(ITextEmbeddingModel model)
    {
        return new TextEmbeddingIndexSettings(model, 0.85, -1);
    }
}
