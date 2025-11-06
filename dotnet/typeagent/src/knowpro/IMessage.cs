// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public interface IMessage : IKnowledgeSource
{
    IList<string> TextChunks { get; set; }

    IList<string>? Tags { get; set; }

    string? Timestamp { get; set; }

    IMessageMetadata? Metadata { get; set; }

    int GetLength();
}

public interface IMessageMetadata
{
    [JsonIgnore]
    string Source { get; }

    [JsonIgnore]
    IList<string>? Dest { get; }
}

public interface IMessageEx : IMessage
{
    string? SerializeExtraDataToJson();
    void DeserializeExtraDataFromJson(string json);
}
