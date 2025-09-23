// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public abstract class ConsoleApp
{
    List<string> _stopStrings;
    RootCommand _allCommands;

    public ConsoleApp(string title = "")
    {
        Console.OutputEncoding = Encoding.UTF8;

        _allCommands = new RootCommand(title);
        AddModule(new StandardCommands());
        _stopStrings = ["quit", "exit"];

    }

    public RootCommand Root => _allCommands;

    public string? ConsolePrompt { get; set; } = ">";

    public IList<string> StopStrings => _stopStrings;

    public string CommentPrefix { get; set; } = "#";

    public string CommandPrefix { get; set; } = "@";

    public int ExitCode { get; set; } = CommandResult.Success;

    public bool EchoBatch { get; set; } = true;

    public async Task RunAsync(string consolePrompt, string? inputFilePath = null)
    {
        ConsolePrompt = consolePrompt;

        WriteTitle();

        if (string.IsNullOrEmpty(inputFilePath))
        {
            await RunAsync();
        }
        else
        {
            await RunBatchAsync(inputFilePath);
        }
    }

    public async Task RunAsync(CancellationToken cancelToken = default)
    {
        while (!cancelToken.IsCancellationRequested)
        {
            Console.Write(ConsolePrompt);

            string? input = await ReadLineAsync(cancelToken).ConfigureAwait(false);
            input = input?.Trim();
            if (string.IsNullOrEmpty(input))
            {
                continue;
            }

            int result = await EvalInputAsync(input, cancelToken).ConfigureAwait(false);
            if (result == CommandResult.Stop)
            {
                break;
            }
        }
    }

    public async Task RunBatchAsync(string batchFilePath, CancellationToken cancelToken = default)
    {
        using var reader = new StreamReader(batchFilePath);
        string? line = null;

        while (!cancelToken.IsCancellationRequested &&
              (line = reader.ReadLine()) is not null)
        {
            line = line.Trim();
            if (line.Length == 0 ||
               line.StartsWith(CommentPrefix))
            {
                continue;
            }

            if (EchoBatch)
            {
                Console.Write(ConsolePrompt);
                Console.WriteLine(line);
            }

            if (await EvalInputAsync(line, cancelToken).ConfigureAwait(false) == CommandResult.Stop)
            {
                break;
            }
        }
    }

    /// <summary>
    /// Process the given user input
    /// </summary>
    /// <param name="input"></param>
    /// <param name="cancellationToken"></param>
    /// <returns></returns>
    public virtual Task<int> ProcessInputAsync(string input, CancellationToken cancellationToken)
    {
        return Task.FromResult<int>(0);
    }

    /// <summary>
    /// Process the given command
    /// </summary>
    /// <param name="cmdLine"></param>
    /// <param name="cancellationToken"></param>
    /// <returns></returns>
    public virtual Task<int> ProcessCommandAsync(string cmdLine, CancellationToken cancellationToken) => EvalCommandAsync(cmdLine, cancellationToken);

    /// <summary>
    /// Process the given command
    /// </summary>
    /// <param name="cmdLine"></param>
    /// <param name="cancellationToken"></param>
    /// <returns></returns>
    public virtual async Task<int> ProcessCommandAsync(string[] cmdLine, CancellationToken cancellationToken = default)
    {
        if (_allCommands.Subcommands.Count == 0)
        {
            return CommandResult.NotHandled;
        }
        var parseResult = _allCommands.Parse(cmdLine);
        return await parseResult.InvokeAsync(null, cancellationToken);
    }

    /// <summary>
    /// Return false if should exit
    /// </summary>
    async Task<int> EvalInputAsync(string input, CancellationToken cancellationToken)
    {
        try
        {
            return input.StartsWith(CommandPrefix)
                ? await EvalCommandAsync(input, cancellationToken).ConfigureAwait(false)
                : await EvalLineAsync(input, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            OnException(input, ex);
        }
        return CommandResult.NotHandled;
    }

    async Task<int> EvalLineAsync(string input, CancellationToken cancellationToken)
    {
        return IsStop(input) ?
               CommandResult.Stop :
               await ProcessInputAsync(input, cancellationToken).ConfigureAwait(false);
    }

    async Task<int> EvalCommandAsync(string input, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrEmpty(CommandPrefix))
        {
            input = input[CommandPrefix.Length..];
        }

        // Split input into command name and args
        string[] cmdLine = [.. CommandLineParser.SplitCommandLine(input)];
        if (cmdLine is null || cmdLine.Length == 0 || string.IsNullOrEmpty(cmdLine[0]))
        {
            return CommandResult.NotHandled;
        }

        try
        {
            string cmd = cmdLine[0];
            return IsStop(cmd) ?
                   CommandResult.Stop :
                   await ProcessCommandAsync(cmdLine, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            OnException(input, ex);
        }

        return CommandResult.NotHandled;
    }

    bool IsStop(string? line)
    {
        return line == null || _stopStrings.Contains(line, StringComparer.OrdinalIgnoreCase);
    }

    public async Task<string?> ReadLineAsync(CancellationToken cancelToken = default)
    {
        string? line = await Console.In.ReadLineAsync(cancelToken).ConfigureAwait(false);
        return line is not null ? line.Trim() : line;
    }

    protected virtual void OnException(string input, Exception ex)
    {
        Console.WriteLine("## Could not process request");
        WriteError(ex);
    }

    protected void WriteError(Exception ex)
    {
        ConsoleWriter.WriteError(ex);
    }

    protected virtual void WriteTitle()
    {
        if (!string.IsNullOrEmpty(_allCommands.Description))
        {
            Console.WriteLine(_allCommands.Description);
            Console.WriteLine();
        }
    }

    public void AddModule(ICommandModule module)
    {
        _allCommands.AddModule(module);
    }

    public void SortCommands()
    {
        var commands = _allCommands.Subcommands.ToList();
        _allCommands.Subcommands.Clear();
        commands.Sort((x, y) => x.Name.CompareTo(y.Name));
        foreach (var cmd in commands)
        {
            _allCommands.Add(cmd);
        }
    }
}
