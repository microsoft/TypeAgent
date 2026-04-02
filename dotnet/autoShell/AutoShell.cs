// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using autoShell.Handlers;
using autoShell.Services;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;


namespace autoShell;

internal class AutoShell
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetCommandLineW();

    private static CommandDispatcher s_dispatcher;


    /// <summary>
    /// Constructor used to get system wide information required for specific commands.
    /// </summary>
    static AutoShell()
    {
        // Initialize command dispatcher with all handlers
        var registry = new WindowsRegistryService();
        var systemParams = new WindowsSystemParametersService();
        var process = new WindowsProcessService();
        var audio = new WindowsAudioService();
        var appRegistry = new WindowsAppRegistry();

        s_dispatcher = new CommandDispatcher();
        s_dispatcher.Register(
            new AudioCommandHandler(audio),
            new AppCommandHandler(appRegistry, process),
            new WindowCommandHandler(appRegistry),
            new ThemeCommandHandler(registry, process, systemParams),
            new VirtualDesktopCommandHandler(appRegistry),
            new NetworkCommandHandler(),
            new DisplayCommandHandler(),
            new TaskbarSettingsHandler(registry),
            new DisplaySettingsHandler(registry, process),
            new PersonalizationSettingsHandler(registry, process),
            new MouseSettingsHandler(systemParams, process),
            new AccessibilitySettingsHandler(registry, process),
            new PrivacySettingsHandler(registry),
            new PowerSettingsHandler(registry, process),
            new FileExplorerSettingsHandler(registry),
            new SystemSettingsHandler(process),
            new SystemCommandHandler(process)
        );
    }

    /// <summary>
    /// Program entry point
    /// </summary>
    /// <param name="args">Any command line arguments</param>
    private static void Main(string[] args)
    {
        string rawCmdLine = Marshal.PtrToStringUni(GetCommandLineW());

        // if there are command line args let's execute those one at a time and then exit
        // user can specify a single JSON object command or an array of them on the command line
        if (args.Length > 0)
        {
            string exe = $"\"{Environment.ProcessPath}\"";
            string cmdLine = rawCmdLine.Replace(exe, "");

            if (cmdLine.StartsWith(exe, StringComparison.OrdinalIgnoreCase))
            {
                cmdLine = cmdLine[exe.Length..];
            }
            else if (cmdLine.StartsWith(Path.GetFileName(Environment.ProcessPath), StringComparison.OrdinalIgnoreCase))
            {
                cmdLine = cmdLine[Path.GetFileName(Environment.ProcessPath).Length..];
            }
            else if (cmdLine.StartsWith(Path.GetFileNameWithoutExtension(Environment.ProcessPath), StringComparison.OrdinalIgnoreCase))
            {
                cmdLine = cmdLine[Path.GetFileNameWithoutExtension(Environment.ProcessPath).Length..];
            }

            try
            {
                JArray commands = JArray.Parse(cmdLine);
                foreach (JObject jo in commands.Children<JObject>())
                {
                    execLine(jo);
                }
            }
            catch (JsonReaderException)
            {
                execLine(JObject.Parse(cmdLine));
            }

            // exit
            return;
        }

        // run in interactive mode, keep accepting commands until we get the shutdown command
        bool quit = false;
        while (!quit)
        {
            try
            {
                // read a line from the console
                string line = Console.ReadLine();

                // if stdin is closed (e.g., piped input finished), exit
                if (line == null)
                {
                    break;
                }

                // parse the line as a json object with one or more command keys (with values as parameters)
                JObject root = JObject.Parse(line);

                // execute the line
                quit = execLine(root);
            }
            catch (Exception ex)
            {
                LogError(ex);
            }
        }
    }

    internal static void LogError(Exception ex)
    {
        Debug.WriteLine(ex);
        ConsoleColor previousColor = Console.ForegroundColor;
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine("Error: " + ex.Message);
        Console.ForegroundColor = previousColor;
    }

    internal static void LogWarning(string message)
    {
        Debug.WriteLine(message);
        ConsoleColor previousColor = Console.ForegroundColor;
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine("Warning: " + message);
        Console.ForegroundColor = previousColor;
    }


    private static bool execLine(JObject root)
        => s_dispatcher.Dispatch(root);

}
