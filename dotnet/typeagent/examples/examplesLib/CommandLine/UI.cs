// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.RegularExpressions;

namespace TypeAgent.ExamplesLib.CommandLine;

public struct CursorPos
{
    public int Left { get; set; }
    public int Top { get; set; }

    public CursorPos Apply()
    {
        var curPos = Capture();
        if (Left >= 0)
        {
            Console.CursorLeft = Left;
        }
        if (Top >= 0)
        {
            Console.CursorTop = Top;
        }
        return curPos;
    }

    public static CursorPos Capture()
    {
        return new()
        {
            Left = Console.CursorLeft,
            Top = Console.CursorTop
        };
    }

    public static CursorPos CaptureLeft()
    {
        return new()
        {
            Left = Console.CursorLeft,
            Top = -1,
        };
    }
}

public class ConsoleControl
{
    string? _lastText;

    public ConsoleControl(CursorPos topLeft)
    {
        _lastText = null;
        TopLeft = topLeft;
    }

    public CursorPos TopLeft { get; }

    protected void Erase()
    {
        if (!string.IsNullOrEmpty(_lastText))
        {
            ConsoleWriter.Erase(_lastText.Length);
        }
        _lastText = null;
    }

    protected void WriteInPlace(string text)
    {
        var curPos = TopLeft.Apply();
        ConsoleWriter.WriteInPlace(text, _lastText);
        _lastText = text;
        curPos.Apply();
    }
}

public class ProgressBar : ConsoleControl
{
    public ProgressBar(int total)
        : this(0, total)
    {
    }

    public ProgressBar(int count, int total)
        : base(CursorPos.CaptureLeft())
    {
        Count = count;
        Total = total;
    }

    public int Count { get; private set; }

    public int Total { get; private set; }

    public void Advance(int amount = 1)
    {
        if (Count >= Total)
        {
            return;
        }

        var next = Count + amount;
        if (next >= Total)
        {
            next = Total;
        }
        Count = next;
        var progressText = $"[{Count} / {Total}]";
        WriteInPlace(progressText);
    }

    public void Complete() => Erase();

    public void Reset(int total = 0)
    {
        Complete();
        Count = 0;
        if (total > 0)
        {
            Total = total;
        }
    }
}
