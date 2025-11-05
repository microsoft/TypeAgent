// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public static class MessageExtensions
{

    /// <summary>
    /// Assigns timestamps to each message between startDate and endDate proportionally to the number
    /// of characters in each message's text chunks. The first message gets startDate; subsequent
    /// timestamps advance assuming a constant speaking rate.
    /// </summary>
    /// <param name="messages">Ordered transcript messages.</param>
    /// <param name="startDate">Inclusive start of the time range.</param>
    /// <param name="endDate">Exclusive end of the time range (must be greater than startDate).</param>
    /// <exception cref="ArgumentNullException">messages is null.</exception>
    /// <exception cref="ArgumentException">endDate is not greater than startDate.</exception>
    public static void TimestampMessages<TMessage>(this IList<TMessage> messages, DateTimeOffset startDate, DateTimeOffset endDate)
        where TMessage : IMessage
    {
        TimeSpan span = endDate - startDate;
        if (span <= TimeSpan.Zero)
        {
            throw new ArgumentException($"{startDate:o} is not < {endDate:o}", nameof(endDate));
        }

        int totalChars = 0;
        var lengths = new int[messages.Count];
        int messageCount = messages.Count;
        for (int i = 0; i < messageCount; ++i)
        {
            int len = messages[i].GetCharCount();
            lengths[i] = len;
            totalChars += len;
        }

        if (totalChars == 0)
        {
            return;
        }

        double ticksPerChar = (double)span.Ticks / totalChars;
        double elapsedTicks = 0.0;

        for (int i = 0; i < messages.Count; ++i)
        {
            // Compute timestamp based on accumulated elapsed ticks.
            var dt = startDate.AddTicks((long)elapsedTicks).ToUniversalTime();
            messages[i].Timestamp = dt.ToISOString();
            elapsedTicks += ticksPerChar * lengths[i];
        }
    }
}
