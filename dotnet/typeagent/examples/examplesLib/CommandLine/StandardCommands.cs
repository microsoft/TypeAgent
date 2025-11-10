// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Security.Cryptography;

namespace TypeAgent.ExamplesLib.CommandLine;

public class StandardCommands : ICommandModule
{
    private RootCommand? _root = null;

    public StandardCommands(RootCommand? root = null)
    {
        this._root = root;
    }

    public IList<Command> GetCommands()
    {
        return [ClearDef(), HelpDef(), PingDef()];
    }

    private Command ClearDef()
    {
        Command cmd = new("clear", "Clear the screen");
        cmd.SetAction(this.Clear);
        return cmd;
    }

    private void Clear(ParseResult args)
    {
        Console.Clear();
    }

    /// <summary>
    /// Creates the @help command
    /// </summary>
    /// <returns>The @help command</returns>
    private Command HelpDef()
    {
        Command cmd = new("help", "Show this list of commands.");
        cmd.SetAction(this.HelpAsync);
        return cmd;
    }

    /// <summary>
    /// Calls the default help command but with @ prefix
    /// </summary>
    /// <param name="args">The </param>
    private async void HelpAsync(ParseResult args)
    {
        if (this._root is not null)
        {
            await this._root.InvokeAsync("--help", CancellationToken.None);
        }
    }

    private Command PingDef()
    {
        Command cmd = new("ping", "Ping pong")
        {
            Args.Arg<string>("msg", "Ping message"),
            Options.Arg<int>("count", "Number of repetitions", 1)
        };
        cmd.SetAction(this.Ping);
        return cmd;
    }

    private void Ping(ParseResult args)
    {
        NamedArgs namedArgs = new(args);
        int count = namedArgs.Get<int>("count");
        for (int i = 0; i < count; ++i)
        {
            Console.WriteLine(namedArgs.Get<string>("msg"));
        }
    }
}
