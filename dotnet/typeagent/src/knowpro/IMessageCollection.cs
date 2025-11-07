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

    ValueTask<IList<IMessageMetadata>> GetMetadataAsync(IList<int> messageOrdinals, CancellationToken cancellationToken = default);

    ValueTask<string?> GetTimestampAsync(int messageOrdinal, CancellationToken cancellationToken = default);

    ValueTask<IList<string>> GetTimestampAsync(IList<int> messageOrdinals, CancellationToken cancellationToken = default);
}

public static class MessageCollectionExtensions
{
    public static ValueTask<List<TMessage>> GetAllAsync<TMessage>(
        this IMessageCollection<TMessage> messages,
        CancellationToken cancellationToken
    )
        where TMessage : IMessage
    {
        return messages.ToListAsync(cancellationToken);
    }

    public static ValueTask<List<IMessage>> GetAllAsync(
        this IMessageCollection messages,
        CancellationToken cancellationToken
    )
    {
        return messages.ToListAsync(cancellationToken);
    }

    internal static async ValueTask<int> GetCountInCharBudgetAsync(
        this IMessageCollection messages,
        IList<int> messageOrdinals,
        int maxCharsInBudget,
        CancellationToken cancellationToken = default
    )
    {
        int messageCount = messageOrdinals.Count;
        var messageLengths = await messages.GetMessageLengthAsync(
            messageOrdinals,
            cancellationToken
        ).ConfigureAwait(false);

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
