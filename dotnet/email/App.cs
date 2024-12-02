// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
using System.Diagnostics;
using TypeAgent.Core;

namespace TypeAgent;

public class App
{
    RootCommand _commands;
    EmailExporter _exporter;
    MailStats _stats;

    public App(Outlook outlook)
    {
        _exporter = new EmailExporter(outlook);
        _stats = new MailStats(outlook);

        _commands = new RootCommand("Mail commands");
        _commands.AddCommand(Command_Quit());
        _commands.AddCommand(Command_Distribution());
        _commands.AddCommand(Command_ExportAll());
    }

    public EmailExporter Exporter => _exporter;

    public Command Command_Distribution()
    {
        Command command = new Command("distribution");
        var pathOption = new Option<string>("--outPath", "Output path");
        command.AddOption(pathOption);
        command.SetHandler<string>((string outPath) =>
        {
            var (counter, histogram) = _stats.GetSizeDistribution();
            ConsoleEx.WriteLineColor(ConsoleColor.Green, $"{counter} items");
            string csv = MailStats.PrintHistogram(histogram);
            if (!string.IsNullOrEmpty(outPath))
            {
                File.WriteAllText(outPath, csv);
            }
            Console.WriteLine(csv);
        }, pathOption);
        return command;
    }

    public Command Command_ExportAll()
    {
        Command command = new Command("exportAll");
        var dirPath = new Option<string>("--destDir", "Output path");
        var maxMessages = new Option<int>("--maxMessages", () => -1, "Max messages to export");
        var bucket = new Option<bool>("--bucket", () => true, "Bucket messages by latest body size");
        var includeJson = new Option<bool>("--includeJson", () => true, "Also export to Json");
        command.AddOption(dirPath);
        command.AddOption(maxMessages);
        command.AddOption(bucket);
        command.AddOption(includeJson);
        command.SetHandler<string, int, bool, bool>((string dirPath, int maxMessages, bool bucket, bool includeJson) =>
        {
            _exporter.ExportAll(dirPath, maxMessages, bucket, includeJson);

        }, dirPath, maxMessages, bucket, includeJson);

        return command;
    }

    Command Command_Quit()
    {
        Command cmd = new Command("quit");
        cmd.SetHandler(() => Environment.Exit(0));
        return cmd;
    }

    static void Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        args = EnsureArgs(args);
        if (args == null || args.Length == 0)
        {
            return;
        }
        try
        {
            using Outlook outlook = new Outlook();
            var app = new App(outlook);
            switch (args[0])
            {
                default:
                    if (args[0].StartsWith('@'))
                    {
                        RunInteractive(app, args);
                    }
                    else
                    {
                        app.Exporter.Export(args.ElementAtOrDefault(0), args.ElementAtOrDefault(1));
                    }
                    break;

                case "--sender":
                    app.Exporter.ExportFrom(args.GetArg(1));
                    break;

                case "--print":
                    app.Exporter.PrintEmail(args.GetArg(1));
                    Console.ReadLine();
                    return;
            }
        }
        catch (System.Exception ex)
        {
            ConsoleEx.LogError(ex);
        }
        finally
        {
            COMObject.ReleaseAll();
        }
    }

    static void RunInteractive(App app, string[] args)
    {
        while (true)
        {
            if (args.Length > 0)
            {
                args[0] = args[0][1..];
                var result = app._commands.Invoke(args);
                if (result != 0)
                {
                    Console.WriteLine($"Command returned {result}");
                }
            }
            args = ConsoleEx.GetInput("📬>");
        }
    }

    static string[]? EnsureArgs(string[] args)
    {
        return args != null && args.Length > 0 ? args : ConsoleEx.GetInput("📬>");
    }
}
