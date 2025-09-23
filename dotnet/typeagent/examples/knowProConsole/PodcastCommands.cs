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
        cmd.SetAction(this.PodcastImportIndexAsync);
        return cmd;
    }

    private async Task PodcastImportIndexAsync(ParseResult args, CancellationToken cancellationToken)
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

        using var provider = new SqliteStorageProvider<PodcastMessage, PodcastMessageMeta>(_kpContext.DotnetPath, "podcast", true);
        var podcast = new Podcast(provider);

        int count = 0;
        foreach (var message in data.Messages)
        {
            await podcast.Messages.AppendAsync(message).ConfigureAwait(false);
            count = await podcast.Messages.GetCountAsync().ConfigureAwait(false);
            Console.WriteLine(count);
        }
        // Read all
        for (int i = 0; i < count; ++i)
        {
            var message = await podcast.Messages.GetAsync(i);
            var json = Json.Stringify(message);
            Console.WriteLine(json);
        }
    }
}
