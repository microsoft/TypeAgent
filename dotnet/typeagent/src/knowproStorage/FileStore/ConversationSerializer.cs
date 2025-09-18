// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.FileStore;

public class ConversationSerializer
{
    public static ConversationJsonData<TMessage, TMeta>? ReadFromFile<TMessage, TMeta>(string filePath)
        where TMessage : IMessage<TMeta>
        where TMeta : IMessageMetadata
    {
        return Json.ParseFile<ConversationJsonData<TMessage, TMeta>>(filePath);
    }
}
