// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.ConversationMemory;

public class Message<TMeta> : IMessage<TMeta>
    where TMeta : IMessageMetadata
{
    [JsonPropertyName("textChunks")]
    public IList<string> TextChunks { get; set; } = [];

    [JsonPropertyName("tags")]
    public IList<string> Tags { get; set; } = [];

    [JsonPropertyName("timestamp")]
    public string? Timestamp { get; set; }

    [JsonPropertyName("metadata")]
    public TMeta? Metadata { get; set; }

    public virtual KnowledgeResponse? GetKnowledge() => null;
}
