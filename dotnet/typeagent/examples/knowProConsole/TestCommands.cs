// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
            TestEmbeddingsDef()
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
            Options.Arg<string>("text", "text to embed")
        };
        cmd.TreatUnmatchedTokensAsErrors = false;
        cmd.SetAction(this.TestEmbeddingsAsync);
        return cmd;
    }

    private async Task TestEmbeddingsAsync(ParseResult args, CancellationToken cancellationToken)
    {
        var settings = AzureModelApiSettings.EmbeddingSettingsFromEnv();
        var model = new TextEmbeddingModel(settings);
        NamedArgs namedArgs = new(args);
        string text = namedArgs.Get("text") ?? "The quick brown fox";

        var result = await model.GenerateAsync(text, cancellationToken);
        KnowProWriter.WriteLine(result.Length);
    }

    async Task TestSearchKnowledgeAsync(IConversation conversation, SearchTermGroup searchGroup, CancellationToken cancellationToken)
    {
        KnowProWriter.WriteLine(searchGroup);

        var results = await conversation.SearchKnowledgeAsync(
            new SearchSelectExpr(searchGroup), null, null, cancellationToken).ConfigureAwait(false);
        KnowProWriter.WriteKnowledgeSearchResults(_kpContext.Conversation!, results);
    }

    private IConversation EnsureConversation()
    {
        return (_kpContext.Conversation is not null)
            ? _kpContext.Conversation!
            : throw new InvalidOperationException("No conversation loaded");
    }

}
