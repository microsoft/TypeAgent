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
            MessagesDef(),
            AliasesDef(),
            SearchRagDef()
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

    private Command AliasesDef()
    {
        Command command = new("kpAliases")
        {
            Options.Arg<string>("term"),
            Options.Arg<string>("alias")
        };
        command.SetAction(this.AliasesAsync);
        return command;
    }
    private async Task AliasesAsync(ParseResult parseResult, CancellationToken cancellationToken)
    {
        IConversation conversation = EnsureConversation();

        //await KnowProWriter.WriteSemanticRefsAsync(conversation);
        NamedArgs namedArgs = new NamedArgs(parseResult);
        var term = namedArgs.Get("term");
        var alias = namedArgs.Get("alias");

        var aliases = conversation.SecondaryIndexes.TermToRelatedTermsIndex.Aliases;
        if (string.IsNullOrEmpty(term))
        {
            // Display all
            var relatedTerms = await aliases.GetTermsAsync(cancellationToken);
            KnowProWriter.WriteList(relatedTerms, ListType.Ol);
        }
        else if (!string.IsNullOrEmpty(alias))
        {
            await aliases.AddTermAsync(term, alias, cancellationToken);
        }
        else
        {
            var relatedTerms = await aliases.LookupTermAsync(term, cancellationToken);
            if (!relatedTerms.IsNullOrEmpty())
            {
                relatedTerms!.ForEach(KnowProWriter.WriteTerm);
            }
        }
    }

    private Command SearchRagDef()
    {
        Command command = new("kpSearchRag")
        {
            Options.Arg<string>("query"),
            Options.Arg<int>("maxMatches", 25),
            Options.Arg<double>("minScore", 0.7),
            Options.Arg<int>("budget", 16 * 1024)
        };
        command.SetAction(this.SearchRagAsync);
        return command;
    }
    private async Task SearchRagAsync(ParseResult args, CancellationToken cancellationToken)
    {
        IConversation conversation = EnsureConversation();

        var namedArgs = new NamedArgs(args);
        var query = namedArgs.Get<string>("query");
        if (string.IsNullOrEmpty(query))
        {
            return;
        }
        var matches = await conversation.SearchConversationRagAsync(
            query,
            namedArgs.Get<int>("maxMatches"),
            namedArgs.Get<double>("minScore"),
            namedArgs.Get<int>("budget"),
            cancellationToken
        );
        await KnowProWriter.WriteConversationSearchResultsAsync(conversation, matches, true);
    }

    private IConversation EnsureConversation()
    {
        return (_kpContext.Conversation is not null)
            ? _kpContext.Conversation!
            : throw new InvalidOperationException("No conversation loaded");
    }
}
