// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.FileStore;

public class FileHeader
{
    [JsonPropertyName("version")]
    public string Version { get; set; }
}

public class ConversationData<TMessage, TMeta>
    where TMessage : IMessage<TMeta>
    where TMeta : IMessageMetadata
{
    [JsonPropertyName("nameTag")]
    public string NameTag { get; set; }

    [JsonPropertyName("messages")]
    public TMessage[] Messages { get; set; }

    [JsonPropertyName("semanticRefs")]
    public SemanticRef[] SemanticRefs { get; set; }
}

public class ConversationJsonData<TMessage, TMeta> : ConversationData<TMessage, TMeta>
    where TMessage : IMessage<TMeta>
    where TMeta: IMessageMetadata
{
    [JsonPropertyName("fileHeader")]
    public FileHeader? FileHeader { get; set; }
}
