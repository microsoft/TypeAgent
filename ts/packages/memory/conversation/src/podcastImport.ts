// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { dateTime, getFileName, readAllText } from "typeagent";
import { Podcast } from "./podcast.js";
import { PodcastMessage, PodcastMessageMeta } from "./podcastMessage.js";
import { ConversationSettings } from "knowpro";
import {
    parseTranscript,
    parseVttTranscript,
    timestampMessages,
} from "./transcript.js";

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

export function parsePodcastTranscriptVtt(
    transcriptText: string,
    startDate?: Date,
): [PodcastMessage[], Set<string>] {
    return parseVttTranscript(
        transcriptText,
        startDate ?? new Date(),
        (speaker) => {
            return new PodcastMessage([], new PodcastMessageMeta(speaker));
        },
    );
}

/**
 * Import a podcast from a transcript file.
 * The podcast contains all messages in the transcript but is *not yet indexed*.
 * You must call podcast.buildIndex if you want to query the podcast
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
    return pod;
}

/**
 * Import a podcast from a VTT transcript file.
 * The podcast contains all messages in the transcript but is *not yet indexed*.
 * You must call podcast.buildIndex if you want to query the podcast
 * @param transcriptFilePath
 * @param podcastName
 * @param startDate
 * @param settings
 * @returns
 */
export async function importPodcastFromVtt(
    transcriptFilePath: string,
    podcastName?: string,
    startDate?: Date,
    settings?: ConversationSettings,
): Promise<Podcast> {
    const transcriptText = await readAllText(transcriptFilePath);
    podcastName ??= getFileName(transcriptFilePath);
    const [messages, participants] = parsePodcastTranscriptVtt(
        transcriptText,
        startDate ?? new Date(),
    );
    assignMessageListeners(messages, participants);
    const pod = new Podcast(podcastName, messages, [podcastName], settings);
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
