// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public class ConsoleStyle
{
    const string Ansi_Reset = "\x1b[0m";

    // ANSI color codes for ConsoleColor equivalents
    public static string Color(ConsoleColor color, string text)
    {
        string ansiCode = color switch
        {
            ConsoleColor.Black => "\x1b[30m",
            ConsoleColor.DarkBlue => "\x1b[34m",
            ConsoleColor.DarkGreen => "\x1b[32m",
            ConsoleColor.DarkCyan => "\x1b[36m",
            ConsoleColor.DarkRed => "\x1b[31m",
            ConsoleColor.DarkMagenta => "\x1b[35m",
            ConsoleColor.DarkYellow => "\x1b[33m",
            ConsoleColor.Gray => "\x1b[37m",
            ConsoleColor.DarkGray => "\x1b[90m",
            ConsoleColor.Blue => "\x1b[94m",
            ConsoleColor.Green => "\x1b[92m",
            ConsoleColor.Cyan => "\x1b[96m",
            ConsoleColor.Red => "\x1b[91m",
            ConsoleColor.Magenta => "\x1b[95m",
            ConsoleColor.Yellow => "\x1b[93m",
            ConsoleColor.White => "\x1b[97m",
            _ => ""
        };
        return $"{ansiCode}{text}{Ansi_Reset}";
    }

    public static string Bold(string text)
    {
        return $"\x1b[1m{text}{Ansi_Reset}";
    }

    public static string Underline(string text)
    {
        return $"\x1b[4m{text}{Ansi_Reset}";
    }

    public static string BoldUnderline(string text)
    {
        return $"\x1b[1;4m{text}{Ansi_Reset}";
    }

    public static string Reset()
    {
        return Ansi_Reset;
    }
}

