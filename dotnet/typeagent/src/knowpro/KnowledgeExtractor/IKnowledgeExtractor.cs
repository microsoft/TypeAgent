// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.KnowledgeExtractor;

public interface IKnowledgeExtractor
{
    KnowledgeExtractorSettings Settings { get; }

    JsonTranslator<ExtractedKnowledge> Translator { get; set; }

    ValueTask<KnowledgeResponse?> ExtractAsync(string message, CancellationToken cancellationToken= default);
}
