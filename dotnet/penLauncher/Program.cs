// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
using System.IO.Pipes;
using System.Net;
using System.Net.Http;
using System.Reflection;
using Microsoft.Win32;

namespace PenLauncher;

/// <summary>
/// Program that either registers or unregisters itself as a click note handler.
/// Upon click note calls a local HTTP server with a GET request.
/// </summary>
internal class Program
{
    /// <summary>
    /// The click note registry key
    /// </summary>
    private const string CLICK_NOTE_KEY = "Software\\Microsoft\\Windows\\CurrentVersion\\ClickNote\\UserCustomization\\SingleClickBelowLock";

    static void Main(string[] args)
    {
        if (!OperatingSystem.IsWindows())
        {
            Console.WriteLine("The application is only supported on Windows.");
            return;
        }

        if (args.Length == 1)
        {
            switch (args[0])
            {
                case "--register":

                    Debug.Assert(Environment.ProcessPath != null);

                    RegistryKey key = Registry.CurrentUser.CreateSubKey(CLICK_NOTE_KEY, true);
                    key.SetValue("CustomAppPath", Environment.ProcessPath);
                    key.SetValue("Override", 0x3);
                    key.SetValue("PenWorkspaceVerb", 0x0);

                    break;

                case "--unregister":

                    Registry.CurrentUser.DeleteSubKey(CLICK_NOTE_KEY);

                    break;

                default:
                    Console.WriteLine($"The supplied command '{args[0]}' is not recognized.");
                    break;
            }
        }
        else if (args.Length == 0)
        {

            try
            {
                using NamedPipeClientStream pipeClient = new NamedPipeClientStream(".", "TypeAgent\\speech", PipeDirection.Out);
                pipeClient.Connect();

                using StreamWriter writer = new StreamWriter(pipeClient) { AutoFlush = true };
                string message = "triggerRecognitionOnce";
                writer.Write(message);
                Console.WriteLine($"Sent to server: {message}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("Unable to connect to the pipe.");
            }
        }
        else
        {
            Console.WriteLine("Unexpected command line arguments.");
        }
    }
}
