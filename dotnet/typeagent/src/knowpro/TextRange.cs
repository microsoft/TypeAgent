// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

/// <summary>
/// A text range within a conversation
/// If 'end' is undefined, the text range represents a point location, identified by 'start'
/// </summary>
public class TextRange : IComparable<TextRange>
{
    public TextRange(int messageOrdinal)
    {
        Start = new TextLocation(messageOrdinal);
    }

    public TextRange(int messageOrdinal, int chunkOrdinal)
    {
        Start = new TextLocation(messageOrdinal, chunkOrdinal);
    }


    [JsonConstructor]
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
    [JsonPropertyName("start")]
    public TextLocation Start { get; private set; }

    /// <summary>
    /// The end of the range (exclusive). If None, the range is a single point.
    /// The end of the range must be at least Start.MessageOrdinal, Start.ChunkOrdinal + 1
    /// </summary>
    [JsonPropertyName("end")]
    public TextLocation? End { get; private set; }

    public override string ToString()
    {
        return End is null ? $"[{Start}]" : $"[{Start}, {End}]";
    }

    /// <summary>
    /// Always returns a valid range End.
    /// If this TextRange has no supplied End, returns an inferred end
    /// </summary>
    /// <returns></returns>
    public TextLocation GetEnd()
    {
        return End ?? AsEnd();
    }

    private TextLocation AsEnd()
    {
        return new TextLocation(Start.MessageOrdinal, Start.ChunkOrdinal + 1);
    }

    public static int Compare(TextRange x, TextRange y)
    {
        int cmp = TextLocation.Compare(x.Start, y.Start);
        if (cmp != 0)
        {
            return cmp;
        }
        if (x.End is null && y.End is null)
        {
            return cmp;
        }
        cmp = TextLocation.Compare(x.End ?? x.Start, y.End ?? y.Start);
        return cmp;
    }

    public static bool IsInTextRange(TextRange outerRange, TextRange innerRange)
    {
        // outer start must be <= inner start
        // inner end must be < outerEnd (which is exclusive)
        int cmpStart = TextLocation.Compare(outerRange.Start, innerRange.Start);
        if (outerRange.End is null && innerRange.End is null) {
            // Since both ends are undefined, we have an point location, not a range.
            // Points must be equal
            return cmpStart == 0;
        }
        int cmpEnd = TextLocation.Compare(
            // innerRange.end must be < outerRange end
            innerRange.End ?? innerRange.Start,
            outerRange.End ?? outerRange.Start
        );
        return cmpStart <= 0 && cmpEnd < 0;
    }

    public int CompareTo(TextRange? other)
    {
        return other is null ? 1 : Compare(this, other);
    }
}
