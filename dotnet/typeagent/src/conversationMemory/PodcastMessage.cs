// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.ConversationMemory;

public class PodcastMessageMeta : MessageMetadata
{
    public PodcastMessageMeta()
    {
    }

    public PodcastMessageMeta(string speaker)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(speaker, nameof(speaker));
        Speaker = speaker;
    }

    [JsonPropertyName("speaker")]
    public string? Speaker { get; set; }

    [JsonPropertyName("listeners")]
    public IList<string> Listeners { get; set; } = [];

    public override string? Source => Speaker;
    public override IList<string>? Dest => Listeners;
}

public class PodcastMessage : Message<PodcastMessageMeta>, ITranscriptMessage
{
    public PodcastMessage()
    {
    }

    public PodcastMessage(string text, string speaker)
        : base(text, new PodcastMessageMeta(speaker))
    {
    }

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
            foreach (var listener in metadata.Listeners)
            {
                entities.Add(EntityFactory.Person(listener));
            }
        }
        return new KnowledgeResponse { Entities = [.. entities] };
    }

    public void AddContent(string content, int chunkOrdinal)
    {
        if (chunkOrdinal > TextChunks.Count - 1)
        {
            TextChunks.Add(content);
        }
        else
        {
            TextChunks[chunkOrdinal] += content;
        }
    }

    public static (IList<PodcastMessage>, ISet<string>) ParseTranscript(string transcriptText)
    {
        return Transcript.Parse(
            transcriptText,
            (speaker, speech) => new PodcastMessage(speech, speaker)
        );
    }
}
