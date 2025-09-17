// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace KnowProConsole;

public class PodcastCommands
{
    [Command("ping")]
    public void Ping(string msg)
    {
        Console.WriteLine(msg);
    }
}
