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
        return cmd;
    }

    private void PodcastLoad(ParseResult args)
    {
        Console.WriteLine("Podcast load");
    }
}
