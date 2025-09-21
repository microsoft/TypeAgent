// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;


public interface IMessage<T> : IKnowledgeSource
    where T : IMessageMetadata
{
    IList<string> TextChunks { get; set; }
    IList<string>? Tags { get; set; }
    string? Timestamp { get; set; }
    T? Metadata { get; set; }
}

public interface IMessageMetadata
{
    string Source { get; }
    IList<string>? Dest { get; }
}
