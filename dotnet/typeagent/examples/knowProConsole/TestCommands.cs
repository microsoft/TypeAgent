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
            SearchPropertyTermsDef()
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
        KnowProWriter.WriteLine(searchGroup);

        var results = await conversation.SearchKnowledgeAsync(searchGroup, null, null, cancellationToken);
        KnowProWriter.WriteKnowledgeSearchResults(_kpContext.Conversation!, results);

        searchGroup = new SearchTermGroup(SearchTermBooleanOp.OrMax, searchGroup.Terms);
        KnowProWriter.WriteLine(ConsoleStyle.Color(ConsoleColor.Cyan, searchGroup.ToString()));

        results = await conversation.SearchKnowledgeAsync(searchGroup, null, null, cancellationToken);
        KnowProWriter.WriteKnowledgeSearchResults(_kpContext.Conversation!, results);

        searchGroup = new SearchTermGroup(SearchTermBooleanOp.And, searchGroup.Terms);
        KnowProWriter.WriteLine(ConsoleStyle.Color(ConsoleColor.Cyan, searchGroup.ToString()));

        results = await conversation.SearchKnowledgeAsync(searchGroup, null, null, cancellationToken);
        KnowProWriter.WriteKnowledgeSearchResults(_kpContext.Conversation!, results);

        searchGroup = new SearchTermGroup(SearchTermBooleanOp.OrMax)
        {
            Terms = [new SearchTerm("Children of Physics"), new SearchTerm("book")]
        };
        KnowProWriter.WriteLine(searchGroup);

        results = await conversation.SearchKnowledgeAsync(searchGroup, null, null, cancellationToken);
        KnowProWriter.WriteKnowledgeSearchResults(_kpContext.Conversation!, results);
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
        KnowProWriter.WriteLine(searchGroup);
    }

    private IConversation EnsureConversation()
    {
        return (_kpContext.Conversation is not null)
            ? _kpContext.Conversation!
            : throw new InvalidOperationException("No conversation loaded");
    }

}
