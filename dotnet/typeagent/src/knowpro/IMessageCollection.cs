// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IMessageCollection<TMessage> : IAsyncCollection<TMessage>
    where TMessage : IMessage
{
    ValueTask<int> GetMessageLengthAsync(int messageOrdinal, CancellationToken cancellationToken = default);
    ValueTask<IList<int>> GetMessageLengthAsync(IList<int> messageOrdinals, CancellationToken cancellationToken = default);
}

public interface IMessageCollection : IReadOnlyAsyncCollection<IMessage>
{
    ValueTask<int> GetMessageLengthAsync(int messageOrdinal, CancellationToken cancellationToken = default);
    ValueTask<IList<int>> GetMessageLengthAsync(IList<int> messageOrdinals, CancellationToken cancellationToken = default);
}

public static class MessageCollectionExtensions
{
    internal static async ValueTask<int> GetCountInCharBudgetAsync(
        this IMessageCollection messages,
        IList<int> messageOrdinals,
        int maxCharsInBudget
    )
    {

        int messageCount = messageOrdinals.Count;
        var messageLengths = await messages.GetMessageLengthAsync(messageOrdinals).ConfigureAwait(false);
        int totalCharCount = 0;
        for (int i = 0; i < messageCount; ++i)
        {
            var messageCharCount = messageLengths[i];
            if (messageCharCount + totalCharCount > maxCharsInBudget)
            {
                return i;
            }
            totalCharCount += messageCharCount;
            ++i;
        }
        return messageCount;
    }
}
