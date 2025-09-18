// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.ConversationMemory;

public class MessageMetadata : IMessageMetadata
{
    public virtual string? Source => null;
    public virtual IList<string>? Dest => null;
}
