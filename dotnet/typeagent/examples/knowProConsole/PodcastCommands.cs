// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace KnowProConsole;

public class PodcastCommands : ICommandModule
{
    KnowProContext _kpContext;

    public PodcastCommands(KnowProContext context)
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

    private Task PodcastImportIndex(ParseResult args, CancellationToken cancellationToken)
    {
        NamedArgs namedArgs = new(args);
        string? filePath = namedArgs.Get("filePath");
        var data = ConversationJsonSerializer.ReadFromFile<PodcastMessage>(filePath!);

        SqliteStorageProvider<PodcastMessage> provider = new SqliteStorageProvider<PodcastMessage>(_kpContext.DotnetPath, "podcast", true);
        return Task.CompletedTask;
    }

}
