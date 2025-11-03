// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro;

public static class ConversatonSearchSimilarity
{
    /// <summary>
    /// Search the conversation messages using similarity to the provided text
    /// Found messages can be filtered by date ranges and other scoping provided
    /// </summary>
    /// <param name="conversation"></param>
    /// <param name="queryText"></param>
    /// <param name="whenFilter"></param>
    /// <param name="options"></param>
    /// <returns></returns>
    public static async ValueTask<ConversationSearchResult> SearchByTextSimilarityAsync(
        this IConversation conversation,
        string queryText,
        WhenFilter? whenFilter,
        SearchOptions? options,
        CancellationToken cancellationToken = default
    )
    {
        options ??= SearchOptions.CreateDefault();
        var context = new QueryEvalContext(conversation, cancellationToken);
        var queryCompiler = new QueryCompiler(conversation, context.Cache, cancellationToken);

        var queryExpr = await queryCompiler.CompileMessageSimilarityQueryAsync(
            queryText,
            whenFilter,
            options
        ).ConfigureAwait(false);

        IList<ScoredMessageOrdinal> messageMatches = queryExpr is not null
            ? await queryExpr.RunAsync(conversation, context).ConfigureAwait(false)
            : [];

        return new ConversationSearchResult(messageMatches, queryText);
    }

    internal static async ValueTask<IList<ConversationSearchResult>> RunQueryTextSimilarityAsync(
        this IConversation conversation,
        SearchQueryExpr query,
        SearchOptions? options = null
    )
    {
        options ??= SearchOptions.CreateDefault();
        List<ConversationSearchResult> results = [];
        foreach (var expr in query.SelectExpressions)
        {
            if (!string.IsNullOrEmpty(query.RawQuery))
            {
                ConversationSearchResult searchResults = await conversation.SearchByTextSimilarityAsync(
                    query.RawQuery,
                    expr.When,
                    options
                ).ConfigureAwait(false);

                if (searchResults.HasResults)
                {
                    results.Add(searchResults);
                }
            }
        }
        return results;
    }
}
