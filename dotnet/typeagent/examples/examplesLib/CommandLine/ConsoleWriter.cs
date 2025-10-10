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

    public static void Write(int value) => Console.Write(value);
    public static void Write(double value) => Console.Write(value);
    public static void Write(bool value) => Console.Write(value);
    public static void Write(object value) => Console.Write(value);
    public static void Write(string value)
    {
        if (!string.IsNullOrEmpty(value))
        {
            Console.Write(value);
        }
    }

    public static void Write(char ch, int count)
    {
        for (int i = 0; i < count; ++i)
        {
            Console.Write(ch);
        }
    }

    public static void InColor(ConsoleColor color, System.Action writer)
    {
        PushColor(color);
        try
        {
            writer();
        }
        finally
        {
            PopColor();
        }
    }

    public static void WriteLine() => Console.WriteLine();
    public static void WriteLine(int value) => Console.WriteLine(value);
    public static void WriteLine(double value) => Console.WriteLine(value);
    public static void WriteLine(object value) => Console.WriteLine(value);
    public static void WriteLine(string value) => Console.WriteLine(value);
    public static void WriteLine(ConsoleColor color, string value)
    {
        PushColor(color);
        WriteLine(value);
        PopColor();
    }

    public static void WriteJson(object value)
    {
        WriteLine(Json.Stringify(value, true));
    }

    public static void WriteJson(ConsoleColor color, object value)
    {
        PushColor(color);
        WriteLine(Json.Stringify(value, true));
        PopColor();
    }

    public static void WriteJson(Array values)
    {
        foreach (var value in values)
        {
            WriteJson(value);
        }
    }

    public static void WriteList(IEnumerable<string> list, string title, ListType type = ListType.Ul)
    {
        if (!string.IsNullOrEmpty(title))
        {
            var isInline = type == ListType.Plain || type == ListType.Csv;
            if (isInline)
            {
                Write(title + ": ");
            }
            else
            {
                WriteLine(title);
            }
        }
        WriteList(list, type);
    }

    public static void WriteList(IEnumerable<string> list, ListType type = ListType.Ul)
    {
        var isInline = type == ListType.Plain || type == ListType.Csv;
        if (isInline)
        {
            var sep = type == ListType.Plain ? " " : ", ";
            foreach (var (i, item) in list.Enumerate())
            {
                if (i > 0)
                {
                    Write(sep);
                }
                Write(item);
            }
            WriteLine();
        }
        else
        {
            foreach (var (i, item) in list.Enumerate())
            {
                WriteListItem(i + 1, item, type);
            }
        }

    }

    private static void WriteListItem(int i, string item, ListType type)
    {
        if (!string.IsNullOrEmpty(item))
        {
            switch (type)
            {
                default:
                    WriteLine(item);
                    break;
                case ListType.Ol:
                    WriteLine($"{i}. {item}");
                    break;
                case ListType.Ul:
                    WriteLine("• " + item);
                    break;
            }

        }
    }

    public static void WriteLineHeading(string title, int level = 1)
    {
        Write('#', level);
        if (!string.IsNullOrEmpty(title))
        {
            Write(" ");
            Write(title);
        }
        WriteLine();
    }

    public static void WriteError(string message)
    {
        PushColor(ConsoleColor.Red);
        WriteLineHeading("ERROR");
        WriteLine(message);
        PopColor();
    }

    public static void WriteError(Exception ex)
    {
        WriteError(ex.Message);
    }

    public static void WriteBold(string text)
    {
        Write(ConsoleStyle.Bold(text));
    }

    public static void WriteLineBold(string text)
    {
        WriteBold(text);
        WriteLine();
    }

    public static void WriteUnderline(string text)
    {
        Write(ConsoleStyle.Underline(text));
    }

    public static void WriteLineUnderline(string text)
    {
        WriteUnderline(text);
        WriteLine();
    }
}

public enum ListType
{
    Ol, // Ordered list - numbered
    Ul, // Unordered list - bullets
    Plain,
    Csv // List in csv format
}
