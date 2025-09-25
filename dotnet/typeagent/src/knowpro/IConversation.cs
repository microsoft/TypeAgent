// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IConversation<TMessage>
    where TMessage : IMessage
{
    string Name { get; }

    IList<string> Tags { get; }

    IMessageCollection<TMessage> Messages { get; }

    ISemanticRefCollection SemanticRefs { get; }

    ITermToSemanticRefIndex SemanticRefIndex { get; }

    IConversationSecondaryIndexes SecondaryIndexes { get; }
}

public static class ConversationExtensions
{
    public static void SearchConversation<TMessage>(
        this IConversation<TMessage> conversation,
        SearchTermGroup searchTermGroup,
        WhenFilter? whenFilter = null
    )
        where TMessage : IMessage
    {

    }
}
