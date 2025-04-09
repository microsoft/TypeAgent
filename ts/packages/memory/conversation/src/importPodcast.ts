// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { dateTime, getFileName, readAllText } from "typeagent";
import { Podcast, PodcastMessage, PodcastMessageMeta } from "./podcast.js";
import { ConversationSettings } from "knowpro";
import { parseTranscript, timestampMessages } from "./transcript.js";

/**
 * Parses a podcast transcript consisting of turns in a conversation.
 * Turn are in the format:
 *  SPEAKER_NAME: TEXT
 *  SPEAKER_NAME:
 *  TEXT
 * @param transcriptText
 * @returns A tuple:
 *  - Array of {@link PodcastMessage}
 * - {@link Set} of identified participants
 */
export function parsePodcastTranscript(
    transcriptText: string,
): [PodcastMessage[], Set<string>] {
    return parseTranscript(
        transcriptText,
        (speaker, speech) =>
            new PodcastMessage([speech], new PodcastMessageMeta(speaker)),
    );
}

/**
 *
 * @param transcriptFilePath Path to a podcast transcript
 * @param podcastName
 * @param startDate
 * @param lengthMinutes
 * @param settings
 * @returns
 */
export async function importPodcast(
    transcriptFilePath: string,
    podcastName?: string,
    startDate?: Date,
    lengthMinutes: number = 60,
    settings?: ConversationSettings,
): Promise<Podcast> {
    const transcriptText = await readAllText(transcriptFilePath);
    podcastName ??= getFileName(transcriptFilePath);
    const [messages, participants] = parsePodcastTranscript(transcriptText);
    assignMessageListeners(messages, participants);
    if (startDate) {
        timestampMessages(
            messages,
            startDate,
            dateTime.addMinutesToDate(startDate, lengthMinutes),
        );
    }
    const pod = new Podcast(podcastName, messages, [podcastName], settings);
    // TODO: add more tags
    return pod;
}

function assignMessageListeners(
    msgs: PodcastMessage[],
    participants: Set<string>,
) {
    for (const msg of msgs) {
        if (msg.metadata.speaker) {
            let listeners: string[] = [];
            for (const p of participants) {
                if (p !== msg.metadata.speaker) {
                    listeners.push(p);
                }
            }
            msg.metadata.listeners = listeners;
        }
    }
}
