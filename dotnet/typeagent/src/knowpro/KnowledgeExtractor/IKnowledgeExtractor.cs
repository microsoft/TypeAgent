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
    public static Task<KnowledgeResponse> ExtractAsync(
        this IKnowledgeExtractor extractor,
        string message,
        RetrySettings retry,
        CancellationToken cancellationToken = default
    )
    {
        return Async.CallWithRetryAsync<KnowledgeResponse>(
            (ct) => extractor.ExtractAsync(message, ct),
            retry,
            null,
            cancellationToken
        );
    }

    public static Task<List<KnowledgeResponse>> ExtractAsync(
        this IKnowledgeExtractor extractor,
        IList<string> messages,
        int concurrency,
        RetrySettings retry,
        Action<BatchProgress>? progress = null,
        CancellationToken cancellationToken = default
    )
    {
        return Async.MapAsync<string, KnowledgeResponse>(
            messages,
            concurrency,
            extractor.ExtractAsync,
            progress,
            cancellationToken
        );
    }
}
