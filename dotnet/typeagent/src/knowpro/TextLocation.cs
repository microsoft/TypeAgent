// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public struct TextLocation
{
    public TextLocation(MessageOrdinal messageOrdinal, int chunkOrdinal)
    {
        this.MessageOrdinal = messageOrdinal;
        this.ChunkOrdinal = chunkOrdinal;
    }

    public MessageOrdinal MessageOrdinal { get; set; }
    public int ChunkOrdinal { get; set; }

    public readonly bool IsLessThan(TextLocation other)
    {
        return this.MessageOrdinal <= other.MessageOrdinal && this.ChunkOrdinal < other.ChunkOrdinal;
    }

    public override readonly string ToString()
    {
        return $"{MessageOrdinal}:{ChunkOrdinal}";
    }
}
