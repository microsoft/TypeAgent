// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Core;

public static class ConsoleEx
{
    public static string[] GetInput(string prompt)
    {
        prompt ??= ">";
        string line;
        while (true)
        {
            Console.Write(prompt);
            line = Console.ReadLine();
            if (line != null)
            {
                line = line.Trim();
            }
            if (!string.IsNullOrEmpty(line))
            {
                return line.ParseCommandLine();
            }
        }
    }

    public static void LogError(System.Exception ex)
    {
        WriteLineColor(ConsoleColor.DarkYellow, $"##Error##\n{ex.Message}\n####");
        Console.WriteLine();
    }

    public static void WriteLineColor(ConsoleColor color, string message)
    {
        var prevColor = Console.ForegroundColor;
        Console.ForegroundColor = color;
        Console.WriteLine(message);
        Console.ForegroundColor = prevColor;
    }

}
