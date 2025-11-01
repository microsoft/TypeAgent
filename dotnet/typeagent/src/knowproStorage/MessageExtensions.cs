// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage;

internal static class MessageExtensions
{
    public static (List<MessageChunkOrdinal>, List<string>) FlattenChunks(this IList<IMessage> messages)
    {
        List<MessageChunkOrdinal> ordinals = new(messages.Count);
        List<string> chunks = new(messages.Count);

        int messageCount = messages.Count;
        for (int iMessage = 0; iMessage < messageCount; ++iMessage)
        {
            IMessage message = messages[iMessage];
            int chunkCount = message.TextChunks.Count;
            for (int iChunk = 0; iChunk < chunkCount; ++iChunk)
            {
                ordinals.Add(new MessageChunkOrdinal { MessageOrdinal = iMessage, ChunkOrdinal = iChunk });
                chunks.Add(message.TextChunks[iChunk]);
            }
        }

        return (ordinals, chunks);
    }
}
