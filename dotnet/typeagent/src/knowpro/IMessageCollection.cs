// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IMessageCollection<TMessage> : IAsyncCollection<TMessage>
    where TMessage : IMessage
{
}

public interface IMessageCollection : IReadOnlyAsyncCollection<IMessage>
{
}

public interface IMessageLoader
{
    ValueTask<IMessage> GetMessageAsync(int messageOrdinal);
    ValueTask<IList<IMessage>> GetMessagesAsync(IList<int> messageOrdinals);
}

public static class MessageCollectionExtensions
{
    public static async ValueTask<int> GetCountInCharBudgetAsync(
        this IAsyncCollectionReader<IMessage> messages,
        IList<int> messageOrdinals,
        int maxCharsInBudget
    )
    {
        int i = 0;
        int totalCharCount = 0;

        // TODO: load in batches/bulk
        foreach (var messageOrdinal in messageOrdinals)
        {
            var message = await messages.GetAsync(messageOrdinal).ConfigureAwait(false);
            var messageCharCount = message.GetCharCount();
            if (messageCharCount + totalCharCount > maxCharsInBudget)
            {
                break;
            }
            totalCharCount += messageCharCount;
            ++i;
        }
        return i;
    }
}
