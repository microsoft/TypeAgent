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
        _commands.AddCommand(Quit());
        _commands.AddCommand(_stats.Command_GetSize());
    }

    public EmailExporter Exporter => _exporter;

    Command Quit()
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
                Console.WriteLine(result);
            }
            args = ConsoleEx.GetInput("📬>");
        }
    }

    static string[]? EnsureArgs(string[] args)
    {
        return args != null && args.Length > 0 ? args : ConsoleEx.GetInput("📬>");
    }
}
