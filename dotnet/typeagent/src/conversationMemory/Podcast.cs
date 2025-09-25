// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public class Podcast : ConversationMemory<PodcastMessage>
{
    public Podcast(IStorageProvider<PodcastMessage> provider)
        : base(provider)
    {

    }

    public static Podcast? ReadFromFile()
    {
        return null;
    }
}
