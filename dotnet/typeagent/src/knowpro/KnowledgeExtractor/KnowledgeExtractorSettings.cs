// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.KnowledgeExtractor;

public class KnowledgeExtractorSettings
{
    public KnowledgeExtractorSettings(int maxCharsPerChunk = 2048)
    {
        ArgumentVerify.ThrowIfLessThanEqual(maxCharsPerChunk, 0, nameof(maxCharsPerChunk));

        MaxContextLength = maxCharsPerChunk;
        MergeEntityFacets = true;
        Concurrency = 2;
    }

    public int MaxContextLength { get; set; }

    public bool MergeEntityFacets { get; set; }

    public RetrySettings? Retry { get; set; }

    public int Concurrency { get; set; }
};
