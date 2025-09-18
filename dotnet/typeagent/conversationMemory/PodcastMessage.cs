// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public class PodcastMessageMeta : MessageMetadata
{
    public string? Speaker { get; set; }
    public IList<string> Listeners { get; set; } = [];

    public override string? Source => Speaker;
    public override IList<string>? Dest => Listeners;
}

public class PodcastMessage : Message<PodcastMessageMeta>
{
}
