// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;
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
            switch(args[0])
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
                HttpClient client = new HttpClient();
                HttpRequestMessage msg = new HttpRequestMessage(HttpMethod.Get, "http://localhost:5282/?listen=true");

                using HttpResponseMessage response = client.Send(msg);

                response.EnsureSuccessStatusCode();

                var request = response.RequestMessage;
                Console.Write($"{request?.Method} ");
                Console.Write($"{request?.RequestUri} ");
                Console.WriteLine($"HTTP/{request?.Version}");

                using (StreamReader sr = new StreamReader(response.Content.ReadAsStream()))
                {
                    var content = sr.ReadToEnd();
                    Console.WriteLine($"{content}\n");
                    ;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Unable to contact the server.");
            }
        }
        else
        {
            Console.WriteLine("Unexpected command line arguments.");
        }
    }
}
