// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Answer;
using TypeAgent.KnowPro.Lang;

namespace TypeAgent.KnowPro;

public static class ConversationAnswer
{
    public static async ValueTask<AnswerResponse> AnswerQuestionAsync(
        this IConversation conversation,
        string question,
        ConversationSearchResult searchResult,
        AnswerContextOptions? contextOptions = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(searchResult, nameof(searchResult));

        AnswerContextBuilder contextBuilder = new AnswerContextBuilder(conversation);

        AnswerContext context = await contextBuilder.FromSearchResultAsync(
            searchResult,
            contextOptions,
            cancellationToken
        ).ConfigureAwait(false);

        IAnswerGenerator generator = conversation.Settings.AnswerGenerator;

        string contextContent = context.ToPromptString();
        bool chunking = contextOptions?.Chunking ?? true;
        if (
            contextContent.Length <= generator.Settings.MaxCharsInBudget ||
            !chunking
        )
        {
            // Context is small enough
            return await generator.GenerateAsync(
                question,
                contextContent,
                cancellationToken
            ).ConfigureAwait(false);
        }

        throw new NotImplementedException("Answer chunking");
    }

    public static async ValueTask<IList<AnswerResponse>> AnswerQuestionAsync(
        this IConversation conversation,
        string question,
        LangSearchOptions? langSearchOptions = null,
        LangSearchFilter? langSearchFilter = null,
        AnswerContextOptions? contextOptions = null,
        Action<BatchProgress>? progress = null,
        CancellationToken cancellationToken = default
    )
    {
        IList<ConversationSearchResult> searchResults = await conversation.SearchAsync(
            question,
            langSearchOptions,
            langSearchFilter,
            null,
            cancellationToken
        ).ConfigureAwait(false);

        if (searchResults.IsNullOrEmpty())
        {
            return [];
        }

        List<AnswerResponse> answerResponses = await searchResults.MapAsync(
            conversation.Settings.AnswerGenerator.Settings.Concurrency,
            async (sr, ct) =>
            {
                return await conversation.AnswerQuestionAsync(
                    question,
                    sr,
                    contextOptions,
                    cancellationToken
                ).ConfigureAwait(false);
            },
            progress,
            cancellationToken
        ).ConfigureAwait(false);

        return answerResponses;
    }

}
