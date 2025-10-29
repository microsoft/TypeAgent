// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class RelatedTermIndexSettings
{
    public RelatedTermIndexSettings(TextEmbeddingIndexSettings embeddingIndexSetting)
    {
        ArgumentVerify.ThrowIfNull(embeddingIndexSetting, nameof(embeddingIndexSetting));
        EmbeddingIndexSetting = embeddingIndexSetting;
    }

    public TextEmbeddingIndexSettings EmbeddingIndexSetting { get; }
}

public interface ITermToRelatedTermIndex
{
    ITermsToRelatedTermsIndex Aliases { get; }

    ITermToRelatedTermsFuzzy FuzzyIndex { get; }
}
