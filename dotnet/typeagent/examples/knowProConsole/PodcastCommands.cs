// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowProConsole;

public class PodcastCommands
{
    [Command]
    public void Ping(string[] msg)
    {
        Console.WriteLine(msg);
    }
}
