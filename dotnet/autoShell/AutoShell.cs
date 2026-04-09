// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.IO;
using System.Runtime.InteropServices;
using autoShell.Logging;
using autoShell.Services.Interop;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace autoShell;

/// <summary>
/// Entry point for the autoShell Windows automation console application.
/// Reads JSON commands from stdin (interactive mode) or command-line arguments
/// and dispatches them to the appropriate handler via <see cref="CommandDispatcher"/>.
/// </summary>
/// <remarks>
/// Each JSON command is a single object where property names are command names
/// and values are parameters, e.g. <c>{"Volume":50}</c> or <c>{"Mute":true}</c>.
/// Multiple commands can be batched in one object: <c>{"Volume":50,"Mute":false}</c>.
/// The special command <c>"quit"</c> exits the application.
/// </remarks>
internal class AutoShell
{
    #region P/Invoke

    [DllImport(NativeDlls.Kernel32, CharSet = CharSet.Unicode)]
    private static extern IntPtr GetCommandLineW();

    #endregion P/Invoke

    private static readonly ConsoleLogger s_logger = new();
    private static readonly CommandDispatcher s_dispatcher = CommandDispatcher.Create(s_logger);

    /// <summary>
    /// Program entry point. Runs in one of two modes:
    /// <list type="bullet">
    ///   <item><description>Command-line mode: executes the JSON command(s) passed as arguments and exits.</description></item>
    ///   <item><description>Interactive mode (no args): reads JSON commands from stdin in a loop until "quit" or EOF.</description></item>
    /// </list>
    /// </summary>
    private static void Main(string[] args)
    {
        if (args.Length > 0)
        {
            RunFromCommandLine();
        }
        else
        {
            RunInteractive();
        }
    }

    /// <summary>
    /// Executes JSON command(s) from command-line arguments and exits.
    /// Accepts a single JSON object (<c>{"Volume":50}</c>) or an array
    /// (<c>[{"Volume":50},{"Mute":true}]</c>).
    /// </summary>
    /// <remarks>
    /// Uses raw command line via P/Invoke to preserve original quoting and spacing,
    /// since the CLR args array strips quotes and splits on spaces.
    /// </remarks>
    private static void RunFromCommandLine()
    {
        string rawCmdLine = Marshal.PtrToStringUni(GetCommandLineW());
        string cmdLine = StripExecutableName(rawCmdLine);

        try
        {
            // Try parsing as a JSON array of commands
            JArray commands = JArray.Parse(cmdLine);
            foreach (JObject jo in commands.Children<JObject>())
            {
                ExecLine(jo);
            }
        }
        catch (JsonReaderException)
        {
            // Not an array — treat as a single JSON object
            ExecLine(JObject.Parse(cmdLine));
        }
    }

    /// <summary>
    /// Reads JSON commands from stdin line by line until "quit" or EOF.
    /// This is the primary mode when autoShell is launched as a child process
    /// by the TypeAgent desktop connector.
    /// </summary>
    private static void RunInteractive()
    {
        bool quit = false;
        while (!quit)
        {
            try
            {
                string line = Console.ReadLine();

                // Null means stdin was closed (e.g., parent process exited)
                if (line == null)
                {
                    break;
                }

                // Each line is a JSON object with one or more command keys
                JObject root = JObject.Parse(line);
                quit = ExecLine(root);
            }
            catch (Exception ex)
            {
                s_logger.Error(ex);
            }
        }
    }

    /// <summary>
    /// Strips the executable name/path from the raw command line string,
    /// leaving only the arguments portion.
    /// </summary>
    private static string StripExecutableName(string rawCmdLine)
    {
        // Try quoted path first: "C:\path\autoShell.exe"
        string exe = $"\"{Environment.ProcessPath}\"";
        string cmdLine = rawCmdLine.Replace(exe, "");

        if (cmdLine.StartsWith(exe, StringComparison.OrdinalIgnoreCase))
        {
            return cmdLine[exe.Length..];
        }

        // Try unquoted filename: autoShell.exe
        var processFileName = Path.GetFileName(Environment.ProcessPath);
        if (cmdLine.StartsWith(processFileName, StringComparison.OrdinalIgnoreCase))
        {
            return cmdLine[processFileName.Length..];
        }

        // Try filename without extension: autoShell
        var processFileNameNoExt = Path.GetFileNameWithoutExtension(processFileName);
        return cmdLine.StartsWith(processFileNameNoExt, StringComparison.OrdinalIgnoreCase)
            ? cmdLine[processFileNameNoExt.Length..]
            : cmdLine;
    }

    /// <summary>
    /// Dispatches a parsed JSON command object to the appropriate handler.
    /// </summary>
    /// <returns><c>true</c> if the application should exit (quit command received).</returns>
    private static bool ExecLine(JObject root)
        => s_dispatcher.Dispatch(root);
}
