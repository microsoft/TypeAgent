// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace KnowProConsole;

public class MemoryCommands : ICommandModule
{
    KnowProConsoleContext _kpContext;

    public MemoryCommands(KnowProConsoleContext context)
    {
        _kpContext = context;
    }

    public IList<Command> GetCommands()
    {
        return [
            SearchTermsDef()
        ];
    }

    private Command SearchTermsDef()
    {
        Command cmd = new("kpSearchTerms")
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
            Terms = [new SearchTerm("Children of Time")]
        };
        await conversation.SearchKnowledgeAsync(searchGroup, null, null, cancellationToken);
    }

    private IConversation EnsureConversation()
    {
        return (_kpContext.Conversation is not null)
            ? _kpContext.Conversation!
            : throw new InvalidOperationException("No conversation loaded");
    }
}
