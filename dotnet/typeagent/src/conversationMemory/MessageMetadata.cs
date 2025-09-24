// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.ConversationMemory;

public class MessageMetadata : IMessageMetadata
{
    [JsonIgnore]
    public virtual string? Source => null;

    [JsonIgnore]
    public virtual IList<string>? Dest => null;
}
