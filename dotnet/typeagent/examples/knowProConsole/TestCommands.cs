// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Lang;

namespace KnowProConsole;

public class TestCommands : ICommandModule
{
    KnowProConsoleContext _kpContext;

    public TestCommands(KnowProConsoleContext context)
    {
        _kpContext = context;
    }

    public IList<Command> GetCommands()
    {   
        return [
            SearchTermsDef(),
            SearchPropertyTermsDef(),
            SearchMessagesTermsDef(),
            TestEmbeddingsDef(),
            SearchQueryTermsDef(),
            BuildIndexDef(),
        ];
    }

    private Command SearchTermsDef()
    {
        Command cmd = new("kpTestSearchTerms")
        {
        };
        cmd.TreatUnmatchedTokensAsErrors = false;
        cmd.SetAction(this.SearchTermsAsync);
        return cmd;
    }

    private async Task SearchTermsAsync(ParseResult result, CancellationToken cancellationToken)
    {
        IConversation conversation = EnsureConversation();

        // Hard coded test for now
        SearchTermGroup searchGroup = new SearchTermGroup(SearchTermBooleanOp.Or)
        {
            "Children of Time",
            "book"
        };
        await TestSearchKnowledgeAsync(conversation, searchGroup, cancellationToken);

        searchGroup = new SearchTermGroup(SearchTermBooleanOp.OrMax, searchGroup.Terms);
        await TestSearchKnowledgeAsync(conversation, searchGroup, cancellationToken);

        searchGroup = new SearchTermGroup(SearchTermBooleanOp.And, searchGroup.Terms);
        await TestSearchKnowledgeAsync(conversation, searchGroup, cancellationToken);

        searchGroup = new SearchTermGroup(SearchTermBooleanOp.OrMax)
        {
            "Children of Physics",
            "book"
        };
        await TestSearchKnowledgeAsync(conversation, searchGroup, cancellationToken);
    }

    private Command SearchPropertyTermsDef()
    {
        Command cmd = new("kpTestPropertyTerms")
        {
        };
        cmd.TreatUnmatchedTokensAsErrors = false;
        cmd.SetAction(this.SearchPropertyTermsAsync);
        return cmd;
    }

    private async Task SearchPropertyTermsAsync(ParseResult result, CancellationToken cancellationToken)
    {
        IConversation conversation = EnsureConversation();

        // Hard coded test for now
        SearchTermGroup searchGroup = new SearchTermGroup(SearchTermBooleanOp.Or)
        {
            { "genre", "sci-fi" },
            { KnowledgePropertyName.EntityName, "Children of Time" },
        };
        await TestSearchKnowledgeAsync(conversation, searchGroup, cancellationToken);
    }

    private Command SearchMessagesTermsDef()
    {
        Command cmd = new("kpTestMessageTerms")
        {
        };
        cmd.TreatUnmatchedTokensAsErrors = false;
        cmd.SetAction(this.SearchMessagesAsync);
        return cmd;
    }

    private async Task SearchMessagesAsync(ParseResult result, CancellationToken cancellationToken)
    {
        IConversation conversation = EnsureConversation();

        var lengths = await conversation.Messages.GetMessageLengthAsync([34], cancellationToken);
        KnowProWriter.WriteJson(lengths);

        var message = await conversation.Messages.GetAsync(34, cancellationToken);
        KnowProWriter.WriteMessage(message);

        var length = await conversation.Messages.GetMessageLengthAsync(34, cancellationToken);
        KnowProWriter.WriteJson(length);

        // Hard coded test for now
        SearchSelectExpr select = new(
            new SearchTermGroup(SearchTermBooleanOp.Or)
            {
                { "genre", "sci-fi" },
                { KnowledgePropertyName.EntityName, "Children of Time" }
            }
        );

        ConversationSearchResult? searchResults = await conversation.SearchConversationAsync(
            select,
            null,
            cancellationToken
        );
        await KnowProWriter.WriteConversationSearchResultsAsync(conversation, searchResults);

        DateRange? conversationDateRange = await conversation.GetDateRangeAsync();
        if (conversationDateRange is not null)
        {
            select.When = new WhenFilter()
            {
                DateRange = new()
                {
                    Start = conversationDateRange.Value.Start,
                    End = conversationDateRange.Value.Start.AddMinutes(10)
                }
            };

        }
        searchResults = await conversation.SearchConversationAsync(
            select,
            new SearchOptions()
            {
                ExactMatch = false,
                MaxCharsInBudget = 1024
            },
            cancellationToken
        );
        await KnowProWriter.WriteConversationSearchResultsAsync(conversation, searchResults, true);
    }

    private Command TestEmbeddingsDef()
    {
        Command cmd = new("kpTestEmbeddings")
        {
            Options.Arg<string>("text", "text to embed"),
            Options.Arg<bool>("add", "add to index")
        };
        cmd.TreatUnmatchedTokensAsErrors = false;
        cmd.SetAction(this.TestEmbeddingsAsync);
        return cmd;
    }

    private async Task TestEmbeddingsAsync(ParseResult args, CancellationToken cancellationToken)
    {
        IConversation conversation = EnsureConversation();

        var settings = AzureModelApiSettings.EmbeddingSettingsFromEnv();
        var model = new OpenAITextEmbeddingModel(settings);
        var modelWithCache = new TextEmbeddingModelWithCache(
            model,
            new TextEmbeddingCache(1024)
        );
        modelWithCache.Cache.PersistentCache = conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex as IReadOnlyCache<string, Embedding>;
        NamedArgs namedArgs = new(args);
        string? text = namedArgs.Get("text");// ?? "The quick brown fox";
        if (!string.IsNullOrEmpty(text))
        {
            var result = await model.GenerateAsync(text, cancellationToken);
            KnowProWriter.WriteLine(result.Length);
            return;
        }

        IList<string> allTerms = await conversation.SemanticRefIndex.GetTermsAsync(cancellationToken);
        var fuzzyIndex = conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex;
        if (namedArgs.Get<bool>("add"))
        {
            await fuzzyIndex.ClearAsync(cancellationToken);
            ProgressBar progress = new ProgressBar(allTerms.Count);
            foreach (var batch in allTerms.Batch(16))
            {
                await fuzzyIndex.AddTermsAsync(batch, cancellationToken);
                progress.Advance(batch.Count);
                await Task.Delay(1000, cancellationToken);
            }
        }

        foreach (var term in allTerms)
        {
            KnowProWriter.WriteLine(ConsoleColor.Cyan, term);
            _kpContext.Stopwatch.Restart();
            var matches = await fuzzyIndex.LookupTermAsync(term, 10, 0, cancellationToken);
            _kpContext.Stopwatch.Stop();
            KnowProWriter.WriteTiming(_kpContext.Stopwatch);
            matches.ForEach(KnowProWriter.WriteTerm);
        }
    }

    private Command BuildIndexDef()
    {
        Command cmd = new("kpTestBuildIndex")
        {
            Options.Arg<bool>("related", "index related terms", false)
        };
        cmd.TreatUnmatchedTokensAsErrors = false;
        cmd.SetAction(this.BuildIndexAsync);
        return cmd;
    }

    private async Task BuildIndexAsync(ParseResult args, CancellationToken cancellationToken)
    {
        IConversation conversation = EnsureConversation();

        NamedArgs namedArgs = new NamedArgs(args);
        if (namedArgs.Get<bool>("related"))
        {
            await conversation.SecondaryIndexes.TermToRelatedTermsIndex.FuzzyIndex.ClearAsync(cancellationToken);

            await conversation.BuildRelatedTermsIndexAsync(cancellationToken);
        }
    }


    async Task TestSearchKnowledgeAsync(IConversation conversation, SearchTermGroup searchGroup, CancellationToken cancellationToken)
    {
        KnowProWriter.WriteLine(searchGroup);

        var results = await conversation.SearchKnowledgeAsync(
            new SearchSelectExpr(searchGroup), null, null, cancellationToken).ConfigureAwait(false);
        KnowProWriter.WriteKnowledgeSearchResults(_kpContext.Conversation!, results);
    }

    private Command SearchQueryTermsDef()
    {
        Command cmd = new("kpTestSearchQuery")
        {
            Args.Arg<string>("query")
        };
        cmd.TreatUnmatchedTokensAsErrors = false;
        cmd.SetAction(this.SearchQueryTermsAsync);
        return cmd;
    }

    private async Task SearchQueryTermsAsync(ParseResult args, CancellationToken cancellationToken)
    {
       // IConversation conversation = EnsureConversation();

        NamedArgs namedArgs = new NamedArgs(args);
        var query = namedArgs.Get("query");
        if (string.IsNullOrEmpty(query))
        {
            return;
        }
        var model = new OpenAIChatModel();
        SearchQueryTranslator translator = new SearchQueryTranslator(model);
        var result = await translator.TranslateAsync(query, cancellationToken);
        KnowProWriter.WriteJson(result);
    }

    private IConversation EnsureConversation()
    {
        return (_kpContext.Conversation is not null)
            ? _kpContext.Conversation!
            : throw new InvalidOperationException("No conversation loaded");
    }

}
