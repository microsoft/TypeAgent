// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Storage.Local;

public class FileHeader
{
    [JsonPropertyName("version")]
    public string Version { get; set; }
}

public class ConversationData<TMessage>
    where TMessage : IMessage
{
    [JsonPropertyName("nameTag")]
    public string NameTag { get; set; }

    [JsonPropertyName("messages")]
    public TMessage[] Messages { get; set; }

    [JsonPropertyName("tags")]
    public string[] Tags { get; set; }

    [JsonPropertyName("semanticRefs")]
    public SemanticRef[] SemanticRefs { get; set; }

    [JsonPropertyName("semanticIndexData")]
    public TermToSemanticRefIndexData? SemanticIndexData { get; set; }
}

public class ConversationJsonData<TMessage> : ConversationData<TMessage>
    where TMessage : IMessage
{
    [JsonPropertyName("fileHeader")]
    public FileHeader? FileHeader { get; set; }
}

public class TermToSemanticRefIndexData
{
    [JsonPropertyName("items")]
    public TermToSemanticRefIndexDataItem[] Items { get; set; }
}

public class TermToSemanticRefIndexDataItem
{
    [JsonPropertyName("term")]
    public string Term { get; set; }
    [JsonPropertyName("semanticRefOrdinals")]
    public ScoredSemanticRefOrdinal[] SemanticRefOrdinals { get; set; }
}
