// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Query;

internal class QueryEvalContext
{
    public QueryEvalContext(IConversation conversation)
    {

    }

    public IConversation Conversation { get; private set; }
}
