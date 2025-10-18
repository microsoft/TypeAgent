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
            SearchTermsDef(),
            MessagesDef()
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

    private Task SearchTermsAsync(ParseResult result, CancellationToken cancellationToken)
    {
        IConversation conversation = EnsureConversation();
        KnowProWriter.WriteError("Not impl");
        return Task.CompletedTask;
    }

    private Command MessagesDef()
    {
        Command command = new("kpMessages");
        command.SetAction(this.MessagesAsync);
        return command;
    }
    private async Task MessagesAsync(ParseResult parseResult, CancellationToken cancellationToken)
    {
        IConversation conversation = EnsureConversation();

        await KnowProWriter.WriteMessagesAsync(conversation);

    }

    private Command SemanticRefsDef()
    {
        Command command = new("kpSemanticRefs");
        command.SetAction(this.SemanticRefsAsync);
        return command;
    }
    private async Task SemanticRefsAsync(ParseResult parseResult, CancellationToken cancellationToken)
    {
        IConversation conversation = EnsureConversation();

        await KnowProWriter.WriteSemanticRefsAsync(conversation);

    }

    private IConversation EnsureConversation()
    {
        return (_kpContext.Conversation is not null)
            ? _kpContext.Conversation!
            : throw new InvalidOperationException("No conversation loaded");
    }
}
