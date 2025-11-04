// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.KnowledgeExtractor;

public interface IKnowledgeExtractor
{
    KnowledgeExtractorSettings Settings { get; }

    JsonTranslator<ExtractedKnowledge> Translator { get; set; }

    Task<KnowledgeResponse> ExtractAsync(string message, CancellationToken cancellationToken = default);

    Task<IList<KnowledgeResponse>> ExtractAsync(IList<string> messages, CancellationToken cancellationToken = default);

    event Action<BatchProgress> OnExtracted;
}

