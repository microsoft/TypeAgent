// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.ConversationMemory;

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

    // Explicit interface implementation for non-generic access
    IMessageMetadata? IMessage.Metadata
    {
        get => Metadata;
        set => Metadata = (TMeta?)value;
    }

    public virtual KnowledgeResponse? GetKnowledge() => null;

    public virtual void DeserializeExtraDataFromJson(string json) { }
    public string SerializeExtraDataToJson()
    {
        throw new NotImplementedException();
    }
}
