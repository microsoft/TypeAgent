// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public static class ConversationExtensions
{
    public static async ValueTask<DateRange?> GetDateRangeAsync(this IConversation conversation)
    {
        var timestampRange = await conversation.GetStartTimestampRangeAsync().ConfigureAwait(false);
        return timestampRange is not null ? new DateRange(timestampRange.Value) : null;
    }

    public static async ValueTask<TimestampRange?> GetStartTimestampRangeAsync(this IConversation conversation)
    {
        // TODO: lower this method the collection

        var messageCount = await conversation.Messages.GetCountAsync().ConfigureAwait(false);
        if (messageCount > 0)
        {
            var start = await conversation.Messages.GetMessageTimestampAsync(1).ConfigureAwait(false);
            var end = await conversation.Messages.GetMessageTimestampAsync(messageCount - 1).ConfigureAwait(false);
            if (start is not null)
            {
                return new TimestampRange
                {
                    StartTimestamp = start,
                    EndTimestamp = end
                };
            }
        }
        return null;
    }
}
