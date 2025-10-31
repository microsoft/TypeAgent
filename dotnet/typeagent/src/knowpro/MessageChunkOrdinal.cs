// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public struct MessageChunkOrdinal
{
    public int MessageOrdinal { get; set; }

    public int ChunkOrdinal { get; set; }

    public TextRange ToRange() => new TextRange(MessageOrdinal, ChunkOrdinal);
}
