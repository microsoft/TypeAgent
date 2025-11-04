// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.KnowledgeExtractor;

public interface IKnowledgeExtractor
{
    KnowledgeExtractorSettings Settings { get; }

    JsonTranslator<ExtractedKnowledge> Translator { get; set; }

    Task<KnowledgeResponse?> ExtractAsync(string message, CancellationToken cancellationToken = default);
}

public static class KnowledgeExtractorExtensions
{
    public static Task<KnowledgeResponse> ExtractWithRetryAsync(
        this IKnowledgeExtractor extractor,
        string message,
        RetrySettings? retry = null,
        CancellationToken cancellationToken = default
    )
    {
        return Async.CallWithRetryAsync(
            (ct) => extractor.ExtractAsync(message, ct),
            retry,
            null,
            cancellationToken
        );
    }

    public static Task<List<KnowledgeResponse>> ExtractWithRetryAsync(
        this IKnowledgeExtractor extractor,
        IList<string> messages,
        int concurrency = 2,
        RetrySettings? retry = null,
        Action<BatchProgress>? progress = null,
        CancellationToken cancellationToken = default
    )
    {
        return messages.MapAsync(
            concurrency,
            (message, ct) => extractor.ExtractWithRetryAsync(message, retry, ct),
            progress,
            cancellationToken
        );
    }
}
