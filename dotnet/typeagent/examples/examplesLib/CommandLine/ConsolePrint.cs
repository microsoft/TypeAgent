// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public static class ConsolePrint
{
    public static void Write(char ch, int count)
    {
        for (int i = 0; i < count; ++i)
        {
            Console.Write(ch);
        }
    }

    public static void WriteLineHeading(string title, int level = 1)
    {
        Write('#', level);
        if (!string.IsNullOrEmpty(title))
        {
            Console.Write(" ");
            Console.Write(title);
        }
        Console.WriteLine();
    }

    public static void WriteLines(string[] lines)
    {
        foreach (var line in lines)
        {
            Console.WriteLine(line);
        }
    }

    public static void WriteLines(string heading, string[] lines)
    {
        WriteLineHeading(heading);
        foreach (var line in lines)
        {
            Console.WriteLine(line);
        }
    }

    public static void WriteError(Exception ex)
    {
        WriteLineHeading("EXCEPTION");
        Console.WriteLine(ex.Message);
    }
}
