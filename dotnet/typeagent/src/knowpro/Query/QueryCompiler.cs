// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class QueryCompiler<TMessage>
    where TMessage: IMessage
{
    private IConversation<TMessage> _conversation;

    internal QueryCompiler(IConversation<TMessage> conversation)
    {
        _conversation = conversation;
    }
}
