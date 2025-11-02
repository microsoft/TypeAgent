// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage;

internal static class MessageExtensions
{
    public static (List<TextLocation>, List<string>) FlattenChunks(this IList<IMessage> messages)
    {
        List<TextLocation> ordinals = new(messages.Count);
        List<string> chunks = new(messages.Count);

        int messageCount = messages.Count;
        for (int iMessage = 0; iMessage < messageCount; ++iMessage)
        {
            IMessage message = messages[iMessage];
            int chunkCount = message.TextChunks.Count;
            for (int iChunk = 0; iChunk < chunkCount; ++iChunk)
            {
                ordinals.Add(new TextLocation { MessageOrdinal = iMessage, ChunkOrdinal = iChunk });
                chunks.Add(message.TextChunks[iChunk]);
            }
        }

        return (ordinals, chunks);
    }
}
