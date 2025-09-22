// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace KnowProConsole;

public class PodcastCommands : ICommandModule
{
    KnowProConsoleContext _kpContext;

    public PodcastCommands(KnowProConsoleContext context)
    {
        _kpContext = context;
    }

    public IList<Command> GetCommands()
    {
        return [
            PodcastLoadDef(),
            PodcastImportIndexDef()
        ];
    }

    private Command PodcastLoadDef()
    {
        Command cmd = new("podcastLoad", "Load existing podcast memory index")
        {
            Args.Arg<string>("filePath", "Path to existing podcast index"),
        };
        cmd.SetAction(this.PodcastLoadAsync);
        return cmd;
    }

    private Task PodcastLoadAsync(ParseResult args, CancellationToken cancellationToken)
    {
        NamedArgs namedArgs = new(args);
        string? filePath = namedArgs.Get("filePath");
        var data = ConversationJsonSerializer.ReadFromFile<PodcastMessage>(filePath!);
        return Task.CompletedTask;
    }

    private Command PodcastImportIndexDef()
    {
        Command cmd = new("podcastImportIndex", "Import existing podcast memory index")
        {
            Args.Arg<string>("filePath", "Path to existing podcast index"),
        };
        cmd.SetAction(this.PodcastImportIndex);
        return cmd;
    }

    private async Task PodcastImportIndex(ParseResult args, CancellationToken cancellationToken)
    {
        NamedArgs namedArgs = new(args);
        string? filePath = namedArgs.Get("filePath");
        var data = ConversationJsonSerializer.ReadFromFile<PodcastMessage>(filePath!);
        if (data is null)
        {
            ConsoleEx.WriteError("NO data in file");
            return;
        }
        Console.WriteLine($"{data.Messages.Length} messages in source file");

        using SqliteStorageProvider<PodcastMessage> provider = new SqliteStorageProvider<PodcastMessage>(_kpContext.DotnetPath, "podcast", true);
        int count = await provider.Messages.GetCountAsync().ConfigureAwait(false);
        Console.WriteLine(count);
        foreach (var message in data.Messages)
        {
            await provider.Messages.AppendAsync(message).ConfigureAwait(false);
            count = await provider.Messages.GetCountAsync().ConfigureAwait(false);
            Console.WriteLine(count);
        }
    }
}
