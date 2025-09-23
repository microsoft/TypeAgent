// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public class ConsoleWriter
{
    static Stack<ConsoleColor> s_colorStack;

    static ConsoleWriter()
    {
        s_colorStack = new Stack<ConsoleColor>();
    }

    public static void PushColor(ConsoleColor color)
    {
        s_colorStack.Push(Console.ForegroundColor);
        Console.ForegroundColor = color;
    }

    public static void PopColor()
    {
        if (s_colorStack.Count > 0)
        {
            Console.ForegroundColor = s_colorStack.Pop();
        }
    }

    public static void Write(string value)
    {
        Console.Write(value);
    }

    public static void Write(char ch, int count)
    {
        for (int i = 0; i < count; ++i)
        {
            Console.Write(ch);
        }
    }

    public static void WriteLine(string value)
    {
        Console.WriteLine(value);
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

    public static void WriteError(string message)
    {
        PushColor(ConsoleColor.Red);
        WriteLineHeading("ERROR");
        Console.WriteLine(message);
        PopColor();
    }

    public static void WriteError(Exception ex)
    {
        WriteError(ex.Message);
    }
}

public enum ListType
{
    Ol, // Ordered list - numbered
    Ul, // Unordered list - bullets
    Plain,
    Csv // List in csv format
}

public struct ListOptions {
    public string? Title { get; set; }

    public ListType Type { get; set; }
};
