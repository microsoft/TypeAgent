// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public class StandardCommands
{
    RootCommand _allCommands;

    public StandardCommands(RootCommand allCommands)
    {
        ArgumentVerify.ThrowIfNull(allCommands, nameof(allCommands));
        _allCommands = allCommands;
    }

    [Command("clear")]
    public int Clear()
    {
        Console.Clear();
        return 0;
    }

    [Command("help")]
    public void Help()
    {
        _allCommands.Invoke("--help");
    }
}
