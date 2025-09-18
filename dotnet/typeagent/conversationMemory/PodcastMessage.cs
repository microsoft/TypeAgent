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
    public override KnowledgeResponse? GetKnowledge()
    {
        PodcastMessageMeta metadata = this.Metadata;
        if (metadata is null || metadata.Speaker is null)
        {
            return null;
        }
        List<ConcreteEntity> entities = [];
        entities.Add(EntityFactory.Person(metadata.Speaker));
        if (!metadata.Listeners.IsNullOrEmpty())
        {
            foreach(var listener in metadata.Listeners)
            {
                entities.Add(EntityFactory.Person(listener));
            }
        }
        return new KnowledgeResponse { Entities = [.. entities] };
    }
}
