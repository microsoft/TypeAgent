// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public class StandardCommands : ICommandModule
{
    public StandardCommands()
    {
    }

    public IList<Command> GetCommands()
    {
        return [ClearDef(), PingDef()];
    }

    private Command ClearDef()
    {
        Command cmd = new ("clear", "Clear the screen");
        cmd.SetAction(this.Clear);
        return cmd;
    }

    private void Clear(ParseResult args)
    {
        Console.Clear();
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
        int count = args.Get<int>("count");
        for (int i = 0; i < count; ++i)
        {
            Console.WriteLine(args.Get<string>("msg"));
        }
    }
}
