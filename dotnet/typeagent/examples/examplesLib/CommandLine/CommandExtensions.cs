// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public static class CommandExtensions
{
    public static Command AddCommands(this Command command, IEnumerable<Command> commands)
    {
        foreach (var cmd in commands)
        {
            command.Add(cmd);
        }

        return command;
    }

    public static Command AddModule(this Command command, ICommandModule module)
    {
        command.AddCommands(module.GetCommands());

        return command;
    }

    public static async Task<int> InvokeAsync(this RootCommand command, string cmdLine, CancellationToken cancellationToken)
    {
        var parseResult = command.Parse(cmdLine);
        return await parseResult.InvokeAsync(null, cancellationToken).ConfigureAwait(false);
    }

    public static int Invoke(this RootCommand command, string cmdLine)
    {
        var parseResult = command.Parse(cmdLine);
        return parseResult.Invoke(null);
    }
}
