// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;


public interface IMessage : IKnowledgeSource
{
    IList<string> TextChunks { get; set; }
    IList<string>? Tags { get; set; }
    string? Timestamp { get; set; }
    IMessageMetadata? Metadata { get; set; }
}

public interface IMessageMetadata
{
    string Source { get; }
    IList<string>? Dest { get; }
}
