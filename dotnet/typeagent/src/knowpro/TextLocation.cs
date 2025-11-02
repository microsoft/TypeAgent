// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public struct TextLocation
{
    public TextLocation(int messageOrdinal, int chunkOrdinal = 0)
    {
        this.MessageOrdinal = messageOrdinal;
        this.ChunkOrdinal = chunkOrdinal;
    }

    [JsonPropertyName("messageOrdinal")]
    public int MessageOrdinal { get; set; }

    [JsonPropertyName("chunkOrdinal")]
    public int ChunkOrdinal { get; set; }

    public readonly bool IsLessThan(TextLocation other)
    {
        return this.MessageOrdinal <= other.MessageOrdinal && this.ChunkOrdinal < other.ChunkOrdinal;
    }

    public readonly bool IsValid() => MessageOrdinal >= 0 && ChunkOrdinal >= 0;

    public TextRange ToRange() => new TextRange(MessageOrdinal, ChunkOrdinal);

    /// <summary>
    // 0 if locations are equal
    // < 0 if x is less than y
    // > 0 if x is greater than y
    /// </summary>
    /// <param name="x"></param>
    /// <param name="y"></param>
    /// <returns></returns>
    public static int Compare(TextLocation x, TextLocation y)
    {
        var cmp = x.MessageOrdinal - y.MessageOrdinal;
        return cmp != 0 ? cmp : x.ChunkOrdinal - y.ChunkOrdinal;
    }

    public override readonly string ToString()
    {
        return $"{MessageOrdinal}:{ChunkOrdinal}";
    }
}
