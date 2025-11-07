// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public static class MessageExtensions
{
    /**
     * Get the total number of a characters in a message.
     * A message can contain multiple text chunks
     * @param {IMessage} message
     * @returns
     */
    public static int GetCharCount(this IMessage message)
    {
        int total = 0;
        int count = message.TextChunks.Count;
        for (int i = 0; i < count; ++i)
        {
            total += message.TextChunks[i].Length;
        }
        return total;
    }

    public static List<int> ToMessageOrdinals(
        this IList<ScoredMessageOrdinal> scoredOrdinals,
        int? topK = null
    )
    {
        return topK is not null && topK.Value < scoredOrdinals.Count
            ? scoredOrdinals.Take(topK.Value).Map((s) => s.MessageOrdinal)
            : scoredOrdinals.Map((s) => s.MessageOrdinal);
    }

    public static IEnumerable<int> AsMessageOrdinals(this IEnumerable<ScoredMessageOrdinal> scoredOrdinals)
    {
        return scoredOrdinals.Select((s) => s.MessageOrdinal);
    }
}
