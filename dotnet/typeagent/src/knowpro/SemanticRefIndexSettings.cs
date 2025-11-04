// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.KnowledgeExtractor;

namespace TypeAgent.KnowPro;

public class SemanticRefIndexSettings
{
    IKnowledgeExtractor _knowledgeExtractor;

    public SemanticRefIndexSettings(IKnowledgeExtractor knowledgeExtractor)
    {
        KnowledgeExtractor = knowledgeExtractor;
        BatchSize = 4;
        Concurrency = 2;
        AutoExtractKnowledge = true;
    }

    public int BatchSize { get; set; }

    public int Concurrency { get; set; }

    public RetrySettings? Retry { get; set; }

    public bool AutoExtractKnowledge { get; set; }

    public IKnowledgeExtractor KnowledgeExtractor
    {
        get => _knowledgeExtractor;
        set
        {
            ArgumentVerify.ThrowIfNull(value, nameof(KnowledgeExtractor));
            _knowledgeExtractor = value;
        }
    }
}
