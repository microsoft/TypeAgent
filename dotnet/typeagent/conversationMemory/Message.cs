// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.ConversationMemory;

public class Message<TMeta> : IMessage<TMeta>
    where TMeta : IMessageMetadata
{
    public IList<string> TextChunks { get; set; } = [];
    public IList<string> Tags { get; set; } = [];
    public string? Timestamp { get; set; }
    public TMeta? Metadata { get; set; }

    public virtual KnowledgeResponse? GetKnowledge() => null;
}
