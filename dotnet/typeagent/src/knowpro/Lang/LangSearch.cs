// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro.Lang;

internal class LangQueryExpr
{
    /**
     * The text of the query.
     */
    public string QueryText { get; set; }
    /**
     * The structured search query the queryText was translated to.
     */
    public SearchQuery Query { get; set; }
    /**
     * The search query expressions the structured query was compiled to.
     */
    public List<SearchQueryExpr> QueryExpressions { get; set; }
};

internal static class LangSearch
{
    public static async ValueTask<LangQueryExpr> SearchQueryExprFromLangAsync(
        this IConversation conversation,
        SearchQueryTranslator translator,
        string queryText,
        LangSearchOptions? options = null,
        LangSearchFilter? langSearchFilter = null,
        LangSearchDebugContext? debugContext = null,
        CancellationToken cancellationToken = default
    )
    {
        var query = await conversation.SearchQueryFromLangAsync(
            translator,
            queryText,
            options?.ModelInstructions,
            default
        ).ConfigureAwait(false);

        if (debugContext is not null)
        {
            debugContext.SearchQuery = query;
        }
        options ??= new LangSearchOptions();
        var queryExpressions = conversation.CompileSearchQuery(
            query,
            options,
            langSearchFilter
        );
        return new LangQueryExpr{
            QueryText = queryText,
            Query = query,
            QueryExpressions = queryExpressions,
        };
    }

    public static async ValueTask<SearchQuery> SearchQueryFromLangAsync(
        this IConversation conversation,
        SearchQueryTranslator queryTranslator,
        string text,
        IList<PromptSection>? promptPreamble,
        CancellationToken cancellationToken = default
    )
    {
        ArgumentVerify.ThrowIfNull(queryTranslator, nameof(queryTranslator));
        ArgumentVerify.ThrowIfNullOrEmpty(text, nameof(text));

        var timeRange = await conversation.GetTimeRangePromptSectionAsync(
            cancellationToken
        ).ConfigureAwait(false);

        Prompt queryContext = new Prompt();
        if (!promptPreamble.IsNullOrEmpty())
        {
            queryContext.AddRange(promptPreamble);
        }
        queryContext.Add(timeRange);

        var result = await queryTranslator.TranslateAsync(
            text,
            queryContext,
            cancellationToken
        ).ConfigureAwait(false);

        return result;
    }

    internal static List<SearchQueryExpr> CompileSearchQuery(
        this IConversation conversation,
        SearchQuery query,
        LangSearchOptions? options,
        LangSearchFilter? langSearchFilter
    )
    {
        ArgumentVerify.ThrowIfNull(query, nameof(query));

        var compiler = new SearchQueryCompiler(conversation, options, langSearchFilter);
        var searchQueryExprs = compiler.CompileQuery(query);
        return searchQueryExprs;
    }
}
