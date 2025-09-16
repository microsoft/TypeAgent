// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class TextRange
{
    public TextRange(TextLocation start)
    {
        Start = start;
        End = new TextLocation(start.MessageOrdinal, start.ChunkOrdinal + 1);
    }

    public TextRange(TextLocation start, TextLocation end)
    {
        if (!start.IsLessThan(end))
        {
            throw new ArgumentException("Invalid text range");
        }
        Start = start; End = end;
    }

    public TextLocation Start { get; private set; }
    /// <summary>
    /// Exclusive.
    /// The End.ChunkOrdinal must always be at least Start.ChunkOrdinal + 1
    /// </summary>
    public TextLocation End { get; private set; }

    public override string ToString()
    {
        return $"[{Start}, {End}]";
    }
}
