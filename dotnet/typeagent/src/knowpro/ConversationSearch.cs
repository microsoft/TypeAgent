// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Lang;
using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro;

public static class ConversationSearch
{
    // TODO: Handle cancellation in these APIS
    // TODO: Add overloads on these APIS


    public static async ValueTask<IDictionary<KnowledgeType, SemanticRefSearchResult>?> SearchKnowledgeAsync(
        this IConversation conversation,
        SearchSelectExpr select,
        SearchOptions? options,
        CancellationToken cancellationToken = default
    )
    {
        QueryEvalContext context = new QueryEvalContext(conversation, cancellationToken);
        QueryCompiler compiler = new QueryCompiler(conversation, context.Cache, cancellationToken);
        options ??= SearchOptions.CreateDefault();

        var queryExpr = await compiler.CompileKnowledgeQueryAsync(
            select.SearchTermGroup,
            select.When,
            options
        ).ConfigureAwait(false);

        return await queryExpr.EvalAsync(context).ConfigureAwait(false);
    }

    public static ValueTask<ConversationSearchResult?> SearchAsync(
        this IConversation conversation,
        SearchSelectExpr select,
        SearchOptions? options = null,
        CancellationToken cancellationToken = default
    )
    {
        return conversation.SearchAsync(select, options, null, cancellationToken);
    }

    public static async ValueTask<ConversationSearchResult?> SearchAsync(
        this IConversation conversation,
        SearchSelectExpr select,
        SearchOptions? options = null,
        string? rawSearchQuery = null,
        CancellationToken cancellationToken = default
    )
    {
        QueryEvalContext context = new QueryEvalContext(conversation, cancellationToken);
        QueryCompiler compiler = new QueryCompiler(conversation, context.Cache, cancellationToken);
        options ??= SearchOptions.CreateDefault();

        var knowledgeQueryExpr = await compiler.CompileKnowledgeQueryAsync(
            select.SearchTermGroup,
            select.When,
            options
        ).ConfigureAwait(false);

        var messageQueryExpr = await compiler.CompileMessageQueryAsync(
            knowledgeQueryExpr,
            options,
            rawSearchQuery
        ).ConfigureAwait(false);

        var messageOrdinals = await messageQueryExpr.EvalAsync(context).ConfigureAwait(false);

        return new ConversationSearchResult(context.KnowledgeMatches, messageOrdinals, rawSearchQuery);
    }

    public static async ValueTask<IList<ConversationSearchResult>> SearchAsync(
        this IConversation conversation,
        string searchText,
        ISearchQueryTranslator queryTranslator,
        LangSearchOptions? options = null,
        LangSearchFilter? langSearchFilter = null,
        LangSearchDebugContext? debugContext = null,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNullOrEmpty(searchText, nameof(searchText));
        ArgumentVerify.ThrowIfNull(queryTranslator, nameof(queryTranslator));

        options ??= LangSearchOptions.CreateDefault();
        LangQueryExpr langQuery = await conversation.SearchQueryExprFromLangAsync(
            queryTranslator,
            searchText,
            options,
            langSearchFilter,
            debugContext,
            cancellationToken
        ).ConfigureAwait(false);

        var searchQueryExprs = langQuery.QueryExpressions;
        if (debugContext is not null)
        {
            debugContext.SearchQueryExpr = searchQueryExprs;
            debugContext.UsedSimilarityFallback = [];
            debugContext.UsedSimilarityFallback.Fill(false, searchQueryExprs.Count);
        }

        List<SearchQueryExpr>? fallbackQueryExprs = CompileFallbackQuery(
            conversation,
            langQuery.Query,
            options,
            langSearchFilter
        );

        List<ConversationSearchResult> searchResults = [];
        int exprCount = searchQueryExprs.Count;
        for (int i = 0; i < exprCount; ++i)
        {
            var searchQueryExpr = searchQueryExprs[i];
            SearchQueryExpr? fallbackExpr = fallbackQueryExprs is not null && i < fallbackQueryExprs.Count
                ? fallbackQueryExprs[i]
                : null;

            var queryResult = await conversation.RunQueryAsync(
                searchQueryExpr,
                options,
                cancellationToken
            ).ConfigureAwait(false);

            if (!HasConversationResults(queryResult) && fallbackExpr is not null)
            {
                // Rerun the query but with verb matching turned off for scopes
                queryResult = await conversation.RunQueryAsync(
                    fallbackExpr.Value,
                    options,
                    cancellationToken
                ).ConfigureAwait(false);
            }
            //
            // If no matches and fallback enabled... run the raw query
            //
            if (!HasConversationResults(queryResult) &&
                !string.IsNullOrEmpty(searchQueryExpr.RawQuery) &&
                options.FallbackRagOptions is not null)
            {
                var similarityMatches = await conversation.RunQueryTextSimilarityAsync(
                    fallbackExpr ?? searchQueryExpr,
                    options.CreateTextQueryOptions()
                ).ConfigureAwait(false);

                if (!similarityMatches.IsNullOrEmpty())
                {
                    searchResults.AddRange(similarityMatches);
                    if (debugContext?.UsedSimilarityFallback is not null)
                    {
                        debugContext.UsedSimilarityFallback[i] = true;
                    }
                }
            }
            else
            {
                searchResults.AddRange(queryResult);
            }
        }

        return searchResults;
    }

    public static async ValueTask<List<ConversationSearchResult>> RunQueryAsync(
        this IConversation conversation,
        SearchQueryExpr queryExpr,
        SearchOptions? options,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(queryExpr, nameof(queryExpr));

        List<ConversationSearchResult> results = [];
        foreach (var selectExpr in queryExpr.SelectExpressions)
        {
            var result = await conversation.SearchAsync(
                selectExpr,
                options,
                queryExpr.RawQuery,
                cancellationToken
            ).ConfigureAwait(false);

            if (result is not null)
            {
                results.Add(result);
            }
        }
        return results;
    }

    public static async ValueTask<ConversationSearchResult?> SearchRagAsync(
        this IConversation conversation,
        string searchText,
        int? maxMatches,
        double? minScore,
        int? maxCharsInBudget = null,
        CancellationToken cancellationToken = default
    )
    {
        IList<ScoredMessageOrdinal> messageMatches = await conversation.SecondaryIndexes.MessageIndex.LookupMessagesAsync(
            searchText,
            maxMatches,
            minScore,
            cancellationToken
        ).ConfigureAwait(false);

        if (messageMatches.IsNullOrEmpty())
        {
            return null;
        }

        if (maxCharsInBudget is not null)
        {
            var messageOrdinals = messageMatches.ToMessageOrdinals();

            int messageCountInBudget = await conversation.Messages.GetCountInCharBudgetAsync(
                messageOrdinals,
                maxCharsInBudget.Value,
                cancellationToken
            ).ConfigureAwait(false);

            Debug.Assert(messageCountInBudget >= 0);
            messageMatches = messageMatches.Slice(0, messageCountInBudget);
        }
        return new ConversationSearchResult(messageMatches, searchText);
    }

    private static List<SearchQueryExpr>? CompileFallbackQuery(
        this IConversation conversation,
        SearchQuery query,
        LangSearchOptions options,
        LangSearchFilter? langSearchFilter
    )
    {
        var cs = options.CompilerSettings;
        if (!cs.ExactScope && cs.VerbScope)
        {
            var fallbackSettings = new LangQueryCompilerSettings
            {
                ApplyScope = cs.ApplyScope,
                ExactScope = cs.ExactScope,
                VerbScope = false,
                TermFilter = cs.TermFilter
            };
            var fallbackOptions = new LangSearchOptions
            {
                MaxKnowledgeMatches = options.MaxKnowledgeMatches,
                MaxMessageMatches = options.MaxMessageMatches,
                ModelInstructions = options.ModelInstructions,
                FallbackRagOptions = options.FallbackRagOptions,
                CompilerSettings = fallbackSettings
            };
            return conversation.CompileSearchQuery(query, fallbackOptions, langSearchFilter);
        }
        return null;
    }

    private static bool HasConversationResults(List<ConversationSearchResult> results)
    {
        return (results.Count > 0) && results.Any(r => r.HasResults);
    }
}
