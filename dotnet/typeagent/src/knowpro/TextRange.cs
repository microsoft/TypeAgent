// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class TextRange
{
    public TextRange(TextLocation start)
    {
        Start = start;
    }

    public TextRange(TextLocation start, TextLocation end)
    {
        if (!start.IsLessThan(end))
        {
            throw new ArgumentException("Invalid text range");
        }
        Start = start; End = end;
    }

    /// <summary>
    /// The start of the range.
    /// </summary>
    public TextLocation Start { get; private set; }
    /// <summary>
    /// The end of the range (exclusive). If None, the range is a single point.
    /// The end of the range must be at least Start.MessageOrdinal, Start.ChunkOrdinal + 1
    /// </summary>
    public TextLocation? End { get; private set; }

    public override string ToString()
    {
        return End is null ? $"[{Start}]" : $"[{Start}, {End}]";
    }

    private TextLocation AsEnd()
    {
        return new TextLocation(Start.MessageOrdinal, Start.ChunkOrdinal + 1);
    }
}
