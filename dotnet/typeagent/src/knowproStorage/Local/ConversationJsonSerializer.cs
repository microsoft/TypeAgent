// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Local;

public class ConversationJsonSerializer
{
    public static ConversationJsonData<TMessage>? ReadFromFile<TMessage>(string filePath)
        where TMessage : IMessage
    {
        return Json.ParseFile<ConversationJsonData<TMessage>>(filePath);
    }
}
