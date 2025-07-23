// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Runtime.InteropServices;
using System.Windows.Threading;

namespace ConsoleApp1;

internal class Program
{
    [DllImport("Kernel32")]
    public static extern void AllocConsole();

    [DllImport("Kernel32")]
    public static extern void FreeConsole();

    internal static Dispatcher dispatcher = Dispatcher.CurrentDispatcher;

    [STAThread]
    static void Main(string[] args)
    {
        AllocConsole();

        var window = new WebViewHostWindow();
        window.Title = "test";
        window.Show();

        // Start the message pump
        Dispatcher.Run();


        //Console.WriteLine("Hello, World!");
        //Window1 w = new Window1();

    }
}
