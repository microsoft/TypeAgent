// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public class Podcast : Memory<PodcastMessage>
{
    public Podcast(MemorySettings settings, IStorageProvider<PodcastMessage> provider)
        : base(settings, provider)
    {
    }

    public static async ValueTask<Podcast> ImportAsync(
        MemorySettings settings,
        IStorageProvider<PodcastMessage> provider,
        string filePath,
        string? name = null,
        DateTimeOffset? startDate = null,
        int lengthMinutes = 60
    )
    {
        Podcast podcast = new Podcast(settings, provider);
        podcast.Name = name;

        string text = File.ReadAllText(filePath);
        if (string.IsNullOrEmpty(text))
        {
            return podcast;
        }
        var (messages, participants) = PodcastMessage.ParseTranscript(text);
        AssignMessageListeners(messages, participants);
        if (startDate is not null)
        {
            messages.TimestampMessages(startDate.Value, startDate.Value.AddMinutes(lengthMinutes));
        }
        await podcast.Messages.AppendAsync(
            messages
        ).ConfigureAwait(false);

        return podcast;
    }

    private static void AssignMessageListeners(IList<PodcastMessage> messages, ISet<string> participants)
    {
        foreach (var message in messages)
        {
            string? speaker = message.Metadata?.Speaker;
            if (!string.IsNullOrEmpty(speaker))
            {
                List<string> listeners = [];
                foreach (var participant in participants)
                {
                    if (participant != speaker)
                    {
                        listeners.Add(participant);
                    }
                }
                message.Metadata.Listeners = listeners;
            }
        }
    }
}
