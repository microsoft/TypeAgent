// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using TypeAgent.KnowPro.Query;

namespace TypeAgent.KnowPro;

public static class ConversationExtensions
{
    public static void SearchConversation<TMessage>(
        this IConversation<TMessage> conversation,
        SearchTermGroup searchTermGroup,
        WhenFilter? whenFilter = null
    )
        where TMessage : IMessage
    {
        QueryCompiler<TMessage> compiler = new QueryCompiler<TMessage>(conversation);
    }
}
