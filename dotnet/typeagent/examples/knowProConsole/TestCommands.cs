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
            SearchMessagesTermsDef()
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
            Terms = [new SearchTerm("Children of Time"), new SearchTerm("book")]
        };
        await TestSearchKnowledgeAsync(conversation, searchGroup, cancellationToken);

        searchGroup = new SearchTermGroup(SearchTermBooleanOp.OrMax, searchGroup.Terms);
        await TestSearchKnowledgeAsync(conversation, searchGroup, cancellationToken);

        searchGroup = new SearchTermGroup(SearchTermBooleanOp.And, searchGroup.Terms);
        await TestSearchKnowledgeAsync(conversation, searchGroup, cancellationToken);

        searchGroup = new SearchTermGroup(SearchTermBooleanOp.OrMax)
        {
            Terms = [new SearchTerm("Children of Physics"), new SearchTerm("book")]
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
            Terms = [
                new PropertySearchTerm("genre", "sci-fi"),
                new PropertySearchTerm(KnowledgePropertyName.EntityName, "Children of Time"),
            ]
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

        // Hard coded test for now
        SearchSelectExpr select = new(
            new SearchTermGroup(SearchTermBooleanOp.Or)
            {
                Terms = [
                    new PropertySearchTerm("genre", "sci-fi"),
                    new PropertySearchTerm(KnowledgePropertyName.EntityName, "Children of Time"),
                ]
            }
        );

        ConversationSearchResult? searchResults = await conversation.SearchConversationAsync(
            select,
            null,
            cancellationToken
        );
        KnowProWriter.WriteConversationSearchResults(conversation, searchResults);

        searchResults = await conversation.SearchConversationAsync(
            select,
            new SearchOptions()
            {
                ExactMatch = false,
                MaxCharsInBudget = 1024
            },
            cancellationToken
        );
        KnowProWriter.WriteConversationSearchResults(conversation, searchResults);
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
