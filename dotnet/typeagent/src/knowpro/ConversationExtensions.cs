// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
                return new TimestampRange
                {
                    StartTimestamp = start,
                    EndTimestamp = end
                };
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
