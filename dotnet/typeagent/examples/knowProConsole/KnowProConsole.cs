// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace KnowProConsole;

public class KnowProConsole : ConsoleApp
{
    public KnowProConsole()
        : base("KnowPro Console")
    {
    }

    public static async Task<int> Main(string[] args)
    {
        KnowProConsole console = new KnowProConsole();
        if (args.IsNullOrEmpty())
        {
            await console.RunAsync("🤖>");
        }
        else
        {
            await console.ProcessCommandAsync(args, CancellationToken.None);
        }
        return console.ExitCode;
    }
}
