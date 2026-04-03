// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.IO;
using System.Runtime.InteropServices;
using autoShell.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace autoShell;

internal class AutoShell
{
    #region P/Invoke

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetCommandLineW();

    #endregion P/Invoke

    private static readonly ConsoleLogger s_logger = new();
    private static readonly CommandDispatcher s_dispatcher = CommandDispatcher.Create(s_logger);

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
            string cmdLine = rawCmdLine!.Replace(exe, "");

            if (cmdLine.StartsWith(exe, StringComparison.OrdinalIgnoreCase))
            {
                cmdLine = cmdLine[exe.Length..];
            }
            else
            {
                var processFileName = Path.GetFileName(Environment.ProcessPath)!;
                if (cmdLine.StartsWith(processFileName, StringComparison.OrdinalIgnoreCase))
                {
                    cmdLine = cmdLine[processFileName.Length..];
                }
                else
                {
                    var processFileNameNoExt = Path.GetFileNameWithoutExtension(processFileName);
                    if (cmdLine.StartsWith(processFileNameNoExt, StringComparison.OrdinalIgnoreCase))
                    {
                        cmdLine = cmdLine[processFileNameNoExt.Length..];
                    }
                }
            }

            try
            {
                JArray commands = JArray.Parse(cmdLine);
                foreach (JObject jo in commands.Children<JObject>())
                {
                    ExecLine(jo);
                }
            }
            catch (JsonReaderException)
            {
                ExecLine(JObject.Parse(cmdLine));
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
                quit = ExecLine(root);
            }
            catch (Exception ex)
            {
                s_logger.Error(ex);
            }
        }
    }

    private static bool ExecLine(JObject root)
        => s_dispatcher.Dispatch(root);
}
