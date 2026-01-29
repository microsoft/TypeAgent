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
        AnswerContextOptions? contextOptions = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(context, nameof(context));

        IAnswerGenerator generator = conversation.Settings.AnswerGenerator;

        int budget = contextOptions?.MaxCharsInBudget ?? generator.Settings.MaxCharsInBudget;

        string contextContent = context.ToPromptString();
        //bool chunking = contextOptions?.Chunking ?? true;
        bool chunking = false; // TODO: chunking not implemented yet
        if (!chunking)
        {
            // Truncate the context if necessary
            return await generator.GenerateAsync(
                question,
                contextContent.Trim(budget),
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
            contextOptions,
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

    /// <summary>
    /// Performs answer generation using RAG search and RAG context for answer generation
    /// </summary>
    /// <param name="conversation">The conversation to use as the context for the question being asked.</param>
    /// <param name="question">The question being asked.</param>
    /// <param name="progress">A progresss callback.</param>
    /// <param name="cancellationToken">The cancellation token to abort if necessary.</param>
    /// <returns></returns>
    public static async ValueTask<AnswerResponse> AnswerQuestionRagAsync(
        this IConversation conversation,
        string question,
        double minScore,
        int maxCharsInBudget,
        AnswerContextOptions? options,
        Action<BatchProgress>? progress = null,
        CancellationToken cancellationToken = default
    )
    {
        ConversationSearchResult searchResults = await conversation.SearchRagAsync(
            question,
            options.MessagesTopK,
            minScore,
            maxCharsInBudget,
            cancellationToken
        ).ConfigureAwait(false);

        if (searchResults is null)
        {
            return AnswerResponse.NoAnswer();
        }

        IAnswerGenerator generator = conversation.Settings.AnswerGenerator;
        AnswerResponse answerResponse = await conversation.AnswerQuestionAsync(
            question,
            searchResults,
            options,
            cancellationToken
        ).ConfigureAwait(false);

        return answerResponse;
    }
}
