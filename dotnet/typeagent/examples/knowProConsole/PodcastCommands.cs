// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace KnowProConsole;

public class PodcastCommands : ICommandModule
{
    public IList<Command> GetCommands()
    {
        return [PodcastLoadDef()];
    }

    private Command PodcastLoadDef()
    {
        Command cmd = new("podcastLoad", "Load existing podcast memory")
        {
            Args.Arg<string>("filePath", "Path to existing podcast index")
        };
        cmd.SetAction(this.PodcastLoadAsync);
        return cmd;
    }

    private Task PodcastLoadAsync(ParseResult args, CancellationToken cancellationToken)
    {
        NamedArgs namedArgs = new(args);
        string? filePath = namedArgs.Get("filePath");
        var data = ConversationSerializer.ReadFromFile<PodcastMessage, PodcastMessageMeta>(filePath!);
        return Task.CompletedTask;
    }
}
