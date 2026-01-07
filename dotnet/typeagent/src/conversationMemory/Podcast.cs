// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using UnslothFormat = TypeAgent.ConversationMemory.PodcastFormats.Unsloth;

namespace TypeAgent.ConversationMemory;

public class Podcast : Memory<PodcastMessage>
{
    public Podcast(MemorySettings settings, IStorageProvider<PodcastMessage> provider)
        : base(settings, provider)
    {
    }

    public async ValueTask BuildIndexAsync(CancellationToken cancellationToken)
    {
        BeginIndexing();
        try
        {
            await this.UpdateIndexAsync(
                cancellationToken
            ).ConfigureAwait(false);

            await BuildSecondaryIndexesAsync(
                cancellationToken
            ).ConfigureAwait(false);
        }
        finally
        {
            EndIndexing();
        }
    }

    public async ValueTask BuildSecondaryIndexesAsync(CancellationToken cancellationToken = default)
    {
        await BuildParticipantAliasesAsync(
            cancellationToken
        ).ConfigureAwait(false);

        await AddSynonymsAsync(
            cancellationToken
        ).ConfigureAwait(false);
    }

    public async ValueTask ImportTranscriptAsync(
        string filePath,
        string? name = null,
        DateTimeOffset? startDate = null,
        int? lengthMinutes = null
    )
    {
        string fileExtension = Path.GetExtension(filePath).ToLowerInvariant();

        if (fileExtension == ".txt")
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
        else if (fileExtension == ".json")
        {
            // TODO: add branching for other JSON formats
            UnslothFormat.PodcastMessage[] messages = Json.ParseFile<UnslothFormat.PodcastMessage[]>(filePath);
            if (messages is not null)
            {
                // accumulate the speakers so we can assign listners
                Dictionary<string, HashSet<string>> participants = [];
                List<PodcastMessage> podcastMessages = [];
                foreach (var message in messages)
                {
                    if (!participants.TryGetValue(message.SectionTitle, out HashSet<string>? value))
                    {
                        value = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        participants.Add(message.SectionTitle, value);
                    }

                    // get the speaker
                    if (!string.IsNullOrEmpty(message.Speaker))
                    {
                        value.Add(message.Speaker);
                    }

                    // convert to PodcastMessage
                    podcastMessages.Add((PodcastMessage)message);
                }

                // Assign listeners
                AssignMessageListeners(podcastMessages, null, participants);

                // append the messages
                await Messages.AppendAsync(
                    podcastMessages
                ).ConfigureAwait(false);
            }
            else
            {
                throw new ArgumentNullException(nameof(filePath), "Failed to parse JSON transcript file.");
            }
        }
        else
        {
            throw new ArgumentOutOfRangeException(nameof(filePath), "Unsupported transcript file format.");
        }
    }

    private async ValueTask AddSynonymsAsync(CancellationToken cancellationToken)
    {
        AliasMap aliases = AliasMap.LoadResource(
            typeof(Podcast).Assembly,
            "TypeAgent.ConversationMemory.podcastVerbs.json"
        );

        await SecondaryIndexes.TermToRelatedTermsIndex.Aliases.AddAsync(
            aliases,
            cancellationToken
        ).ConfigureAwait(false);
    }

    private async ValueTask BuildParticipantAliasesAsync(CancellationToken cancellationToken = default)
    {
        var aliases = await CollectParticipantAliasesAsync(
            cancellationToken
        ).ConfigureAwait(false);

        await SecondaryIndexes.TermToRelatedTermsIndex.Aliases.AddAsync(
            aliases,
            cancellationToken
        ).ConfigureAwait(false);
    }

    private async ValueTask<AliasMap> CollectParticipantAliasesAsync(CancellationToken cancellationToken = default)
    {
        AliasMap aliases = [];
        await foreach (var message in Messages)
        {
            PodcastMessageMeta metadata = message.Metadata;
            metadata.CollectAliases(aliases);
        }
        return aliases;
    }

    private void AssignMessageListeners(IEnumerable<PodcastMessage> messages, ISet<string> participants, Dictionary<string, HashSet<string>> dictParticipants = null)
    {
        foreach (var message in messages)
        {
            string? speaker = message.Metadata?.Speaker;
            if (!string.IsNullOrEmpty(speaker))
            {
                var pp = participants ?? dictParticipants?[message.Tags.Count > 0 ? message.Tags[0] : ""];
                foreach (var participant in pp)
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
