// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using static System.Runtime.InteropServices.JavaScript.JSType;

namespace TypeAgent.KnowPro;

public static class ConversationExtensions
{
    public static IAsyncCollectionReader<SemanticRef> GetSemanticRefReader(this IConversation conversation)
    {
        return conversation.Cache?.SemanticRefs ?? conversation.SemanticRefs;
    }

    public static IAsyncCollectionReader<IMessage> GetMessageReader(this IConversation conversation)
    {
        return conversation.Cache?.Messages ?? conversation.Messages;
    }

    public static async ValueTask<IList<string>> GetParticipantsAsync(this IConversation conversation)
    {
        HashSet<string> participants = [];

        await foreach (IMessage msg in conversation.Messages)
        {
            if (!string.IsNullOrEmpty(msg.Metadata.Source))
            {
                participants.Add(msg.Metadata.Source);
            }
        }

        return [.. participants];
    }

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
            var start = await conversation.Messages.GetTimestampAsync(1).ConfigureAwait(false);
            var end = await conversation.Messages.GetTimestampAsync(messageCount - 1).ConfigureAwait(false);
            if (start is not null)
            {
                // Try to parse the date time so we can pretty up the output
                if (System.DateTime.TryParse(start, out System.DateTime startDate) && System.DateTime.TryParse(end, out System.DateTime endDate))
                {
                    return new TimestampRange
                    {
                        StartTimestamp = startDate.ToString("r"),
                        EndTimestamp = endDate.ToString("r")
                    };
                }
                else
                {
                    return new TimestampRange
                    {
                        StartTimestamp = start,
                        EndTimestamp = end
                    };
                }
            }
        }
        return null;
    }

    public static async ValueTask<PromptSection?> GetTimeRangePromptSectionAsync(
        this IConversation conversation,
        CancellationToken cancellationToken
    )
    {
        var timeRange = await conversation.GetStartTimestampRangeAsync().ConfigureAwait(false);
        if (timeRange is not null)
        {
            var content = $"ONLY IF user request explicitly asks for time ranges, THEN use the CONVERSATION TIME RANGE: \"{timeRange.Value.StartTimestamp} to {timeRange.Value.EndTimestamp}\"`";
            return new PromptSection(content);
        }
        return null;
    }
}
