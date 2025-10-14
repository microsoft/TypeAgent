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
    [JsonIgnore]
    string Source { get; }

    [JsonIgnore]
    IList<string>? Dest { get; }
}

public class Message : IMessage
{
    public IList<string> TextChunks { get; set; }
    public IList<string>? Tags { get; set; }
    public string? Timestamp { get; set; }
    public IMessageMetadata? Metadata { get; set; }

    public KnowledgeResponse? GetKnowledge() { return null; }
}

public interface IMessageEx : IMessage
{
    string? SerializeExtraDataToJson();
    void DeserializeExtraDataFromJson(string json);
}


public static class MessageExtensions
{
    /**
     * Get the total number of a characters in a message.
     * A message can contain multiple text chunks
     * @param {IMessage} message
     * @returns
     */
    public static int GetCharCount(this IMessage message)
    {
        int total = 0;
        for (int i = 0; i < message.TextChunks.Count; ++i)
        {
            total += message.TextChunks[i].Length;
        }
        return total;
    }
}
