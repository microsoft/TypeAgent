// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.KnowledgeExtractor;

public interface IKnowledgeExtractor
{
    KnowledgeExtractorSettings Settings { get; }

    JsonTranslator<KnowledgeResponse> Translator { get; set; }

    ValueTask<TypeAgent.KnowPro.KnowledgeResponse?> ExtractAsync(string message, CancellationToken cancellationToken= default);
}
