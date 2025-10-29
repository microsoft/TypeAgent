// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public class Podcast : Memory<PodcastMessage>
{
    public Podcast(ConversationSettings settings, IStorageProvider<PodcastMessage> provider)
        : base(settings, provider)
    {

    }
}
