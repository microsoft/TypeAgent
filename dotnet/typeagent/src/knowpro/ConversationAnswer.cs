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
        AnswerContext context,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(context, nameof(context));

        IAnswerGenerator generator = conversation.Settings.AnswerGenerator;

        string contextContent = context.ToPromptString();
        //bool chunking = contextOptions?.Chunking ?? true;
        bool chunking = false; // TODO: chunking not implemented yet
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


    public static async ValueTask<AnswerResponse> AnswerQuestionAsync(
        this IConversation conversation,
        string question,
        ConversationSearchResult searchResult,
        AnswerContextOptions? contextOptions = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(searchResult, nameof(searchResult));
        AnswerContext context = await AnswerContext.FromSearchResultAsync(
            conversation,
            searchResult,
            contextOptions,
            cancellationToken
        ).ConfigureAwait(false);

        return await conversation.AnswerQuestionAsync(
            question,
            context,
            cancellationToken
        ).ConfigureAwait(false);
    }

    public static async ValueTask<AnswerResponse> AnswerQuestionAsync(
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
            return AnswerResponse.NoAnswer();
        }

        IAnswerGenerator generator = conversation.Settings.AnswerGenerator;
        // Get answers for individual questions in parallel
        List<AnswerResponse> answerResponses = await searchResults.MapAsync(
            generator.Settings.Concurrency,
            async (searchResult, ct) =>
            {
                return await conversation.AnswerQuestionAsync(
                    question,
                    searchResult,
                    contextOptions,
                    cancellationToken
                ).ConfigureAwait(false);
            },
            progress,
            cancellationToken
        ).ConfigureAwait(false);

        if (answerResponses.Count == 1)
        {
            return answerResponses[0];
        }
        var combinedResponse = await generator.CombinePartialAsync(
            question,
            answerResponses,
            cancellationToken
        ).ConfigureAwait(false);
        return combinedResponse;
    }
}
