// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace KnowProConsole;

public class PodcastCommands : ICommandModule
{
    
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
        cmd.SetAction(this.PodcastLoadAsync);
        return cmd;
    }

    private Task PodcastImportIndex(ParseResult args, CancellationToken cancellationToken)
    {
        NamedArgs namedArgs = new(args);
        string? filePath = namedArgs.Get("filePath");
        var data = ConversationJsonSerializer.ReadFromFile<PodcastMessage>(filePath!);

        return Task.CompletedTask;
    }

}
