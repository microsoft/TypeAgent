// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kpLib from "knowledge-processor";
import { dateTime, getFileName, readAllText } from "typeagent";
import {
    Podcast,
    PodcastMessage,
    PodcastMessageMeta,
    assignMessageListeners,
} from "./podcast.js";
import { ConversationSettings, IMessage } from "knowpro";

export function parsePodcastTranscript(
    transcriptText: string,
): [PodcastMessage[], Set<string>] {
    const turnParserRegex = /^(?<speaker>[A-Z0-9 ]+:)?(?<speech>.*)$/;
    const transcriptLines = getTranscriptLines(transcriptText);
    const participants = new Set<string>();
    const messages: PodcastMessage[] = [];
    let curMsg: PodcastMessage | undefined = undefined;

    for (const line of transcriptLines) {
        const match = turnParserRegex.exec(line);
        if (match && match.groups) {
            let speaker = match.groups["speaker"];
            let speech = match.groups["speech"];
            if (curMsg) {
                if (speaker) {
                    messages.push(curMsg);
                    curMsg = undefined;
                } else if (speech) {
                    curMsg.addContent("\n" + speech);
                }
            }
            if (!curMsg) {
                if (speaker) {
                    speaker = prepareSpeakerName(speaker);
                    participants.add(speaker);
                }
                curMsg = new PodcastMessage(
                    [speech.trim()],
                    new PodcastMessageMeta(speaker),
                );
            }
        }
    }
    if (curMsg) {
        messages.push(curMsg);
    }
    return [messages, participants];
}

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

/**
 * Text (such as a transcript) can be collected over a time range.
 * This text can be partitioned into blocks. However, timestamps for individual blocks are not available.
 * Assigns individual timestamps to blocks proportional to their lengths.
 * @param turns Transcript turns to assign timestamps to
 * @param startDate starting
 * @param endDate
 */
export function timestampMessages(
    messages: IMessage[],
    startDate: Date,
    endDate: Date,
): void {
    let startTicks = startDate.getTime();
    const ticksLength = endDate.getTime() - startTicks;
    if (ticksLength <= 0) {
        throw new Error(`${startDate} is not < ${endDate}`);
    }
    let messageLengths = messages.map((m) => messageLength(m));
    const textLength: number = messageLengths.reduce(
        (total: number, l) => total + l,
        0,
    );
    const ticksPerChar = ticksLength / textLength;
    for (let i = 0; i < messages.length; ++i) {
        messages[i].timestamp = new Date(startTicks).toISOString();
        // Now, we will 'elapse' time .. proportional to length of the text
        // This assumes that each speaker speaks equally fast...
        startTicks += ticksPerChar * messageLengths[i];
    }

    function messageLength(message: IMessage): number {
        return message.textChunks.reduce(
            (total: number, chunk) => total + chunk.length,
            0,
        );
    }
}

function getTranscriptLines(transcriptText: string): string[] {
    return kpLib.split(transcriptText, /\r?\n/, {
        removeEmpty: true,
        trim: true,
    });
}

function prepareSpeakerName(speaker: string): string {
    speaker = speaker.trim();
    if (speaker.endsWith(":")) {
        speaker = speaker.slice(0, speaker.length - 1);
    }
    speaker = speaker.toLocaleLowerCase();
    return speaker;
}
