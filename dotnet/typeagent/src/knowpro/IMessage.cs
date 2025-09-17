// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;


public interface IMessage<T>
    where T : IMessageMetadata
{
    string[] TextChunks { get; set; }
    string[]? Tags { get; set; }
    string? Timestamp { get; set; }
    T? Metadata { get; set; }
}

public interface IMessageMetadata
{
    string[]? Source { get; set; }
    string[]? Dest { get; set; }
}