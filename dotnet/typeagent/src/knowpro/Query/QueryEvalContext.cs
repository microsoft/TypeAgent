// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class QueryEvalContext
{
    public QueryEvalContext(IConversation conversation)
    {
        ArgumentVerify.ThrowIfNull(conversation, nameof(conversation));
        Conversation = conversation;
    }

    public IConversation Conversation { get; private set; }
}
