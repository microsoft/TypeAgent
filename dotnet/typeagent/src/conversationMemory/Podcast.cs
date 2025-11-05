// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public class Podcast : Memory<PodcastMessage>
{
    public Podcast(MemorySettings settings, IStorageProvider<PodcastMessage> provider)
        : base(settings, provider)
    {
    }

    public async ValueTask ImportTranscriptAsync(
        string filePath,
        string? name = null,
        DateTimeOffset? startDate = null,
        int? lengthMinutes = null
    )
    {
        // delegate error checking
        string text = File.ReadAllText(filePath);
        if (string.IsNullOrEmpty(text))
        {
            return;
        }
        var (messages, participants) = PodcastMessage.ParseTranscript(text);
        AssignMessageListeners(messages, participants);
        if (startDate is not null)
        {
            messages.TimestampMessages(startDate.Value, startDate.Value.AddMinutes(lengthMinutes ?? 60));
        }

        await Messages.AppendAsync(
            messages
        ).ConfigureAwait(false);
    }

    private void AssignMessageListeners(IList<PodcastMessage> messages, ISet<string> participants)
    {
        foreach (var message in messages)
        {
            string? speaker = message.Metadata?.Speaker;
            if (!string.IsNullOrEmpty(speaker))
            {
                foreach (var participant in participants)
                {
                    if (participant != speaker)
                    {
                        message.Metadata.Listeners.Add(participant);
                    }
                }
            }
        }
    }
}
