// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace KnowProConsole;

public class KnowProConsoleContext : KnowProContext
{
    public KnowProConsoleContext()
    {
    }
}

public class KnowProConsole : ConsoleApp
{
    KnowProConsoleContext _context;

    public KnowProConsole()
        : base("KnowPro Console")
    {
        _context = new KnowProConsoleContext();
        AddModules(
            new MemoryCommands(_context),
            new PodcastCommands(_context),
            new TestCommands(_context)
        );
        SortCommands();
    }

    public static async Task<int> Main(string[] args)
    {
        string dotEnvPath = "..\\..\\..\\..\\..\\..\\..\\ts\\.env";
        if (Dotenv.LoadIfExists(dotEnvPath) == 0)
        {
            KnowProWriter.WriteError("NO .env variables applied");
        }
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
