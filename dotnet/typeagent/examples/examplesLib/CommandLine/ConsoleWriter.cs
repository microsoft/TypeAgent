// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

public class ConsoleWriter
{
    public class Style : ConsoleStyle
    {
    }

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

    public static void WriteLine() => Console.WriteLine();
    public static void WriteLine(int value) => Console.WriteLine(value);
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

    public static void WriteJson(Array values)
    {
        foreach (var value in values)
        {
            WriteJson(value);
        }
    }

    public static void WriteList(IEnumerable<string> list, ListOptions? options = null)
    {
        options ??= new() { Type = ListType.Plain };

        var isInline = options.Type == ListType.Plain || options.Type == ListType.Csv;
        if (!string.IsNullOrEmpty(options.Title))
        {
            if (isInline)
            {
                Write(options.Title + ": ");
            }
            else
            {
                WriteLine(options.Title);
            }
        }
        if (isInline)
        {
            var sep = options.Type == ListType.Plain ? " " : ", ";
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
                WriteListItem(i, item, options);
            }
        }

    }

    private static void WriteListItem(int i, string item, ListOptions options)
    {
        if (!string.IsNullOrEmpty(item))
        {
            switch (options.Type)
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

    public static void WriteListInColor(ConsoleColor color, IEnumerable<string> list, ListOptions? options = null)
    {
        PushColor(color);
        WriteList(list, options);
        PopColor();
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
        Write(Style.Bold(text));
    }

    public static void WriteLineBold(string text)
    {
        WriteBold(text);
        WriteLine();
    }

    public static void WriteUnderline(string text)
    {
        Write(Style.Underline(text));
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

public class ListOptions
{
    public string? Title { get; set; }

    public ListType Type { get; set; }
};
