// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class Message : IMessage
{
    public IList<string> TextChunks { get; set; }
    public IList<string>? Tags { get; set; }
    public string? Timestamp { get; set; }
    public IMessageMetadata? Metadata { get; set; }

    public KnowledgeResponse? GetKnowledge() { return null; }

    public int GetLength()
    {
        return this.GetCharCount();
    }
}

public class Message<TMeta> : IMessageEx where TMeta : IMessageMetadata
{
    public Message()
    {
    }

    [JsonPropertyName("textChunks")]
    public IList<string> TextChunks { get; set; } = [];

    [JsonPropertyName("tags")]
    public IList<string> Tags { get; set; } = [];

    [JsonPropertyName("timestamp")]
    public string? Timestamp { get; set; }

    // Strongly-typed property
    [JsonPropertyName("metadata")]
    public TMeta? Metadata { get; set; }

    public int GetLength()
    {
        return this.GetCharCount();
    }

    // Explicit interface implementation for non-generic access
    IMessageMetadata? IMessage.Metadata
    {
        get => Metadata;
        set => Metadata = (TMeta?)value;
    }

    public virtual KnowledgeResponse? GetKnowledge() => null;

    public virtual void DeserializeExtraDataFromJson(string json) { }
    public string? SerializeExtraDataToJson() { return null; }
}
