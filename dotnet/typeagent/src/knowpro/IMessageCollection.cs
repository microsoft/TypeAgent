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


public static class MessageCollectionExtensions
{
    /*
    public ValueTask<int> GetCountOfMessagesInCharBudget(this IMessageCollection messages, IEnumerable<int> messageOrdinals, int maxCharsInBudget)
    {
        int i = 0;
        int totalCharCount = 0;

        foreach (var messageOrdinal in messageOrdinals)
        {
            var message = messages.GetAsync(messageOrdinal);
        const messageCharCount = getMessageCharCount(message);
            if (messageCharCount + totalCharCount > maxCharsInBudget) {
                break;
            }
            totalCharCount += messageCharCount;
            ++i;
        }
        return i;
    }
    */

}
