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
import { IMessage } from "knowpro";

const turnParserRegex = /^(?<speaker>[A-Z0-9 ]+:)\s*?(?<speech>.*)$/;

export function parsePodcastTranscript(
    transcriptText: string,
): [PodcastMessage[], Set<string>] {
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
                } else {
                    curMsg.addContent("\n" + speech);
                }
            }
            if (!curMsg) {
                if (speaker) {
                    speaker = speaker.trim();
                    if (speaker.endsWith(":")) {
                        speaker = speaker.slice(0, speaker.length - 1);
                    }
                    speaker = speaker.toLocaleLowerCase();
                    participants.add(speaker);
                }
                curMsg = new PodcastMessage(
                    [speech],
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

export function parsePodcastSpeakers(transcriptText: string): string[] {
    const regex = turnParserRegex;
    const transcriptLines = getTranscriptLines(transcriptText);
    const speakers: string[] = [];
    transcriptLines.forEach((line) => {
        const match = regex.exec(line);
        if (match && match.groups) {
            if (match.groups.speaker) {
                speakers.push(match.groups.speaker);
            }
        }
    });
    return speakers;
}

export async function importPodcast(
    transcriptFilePath: string,
    podcastName?: string,
    startDate?: Date,
    lengthMinutes: number = 60,
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
    const pod = new Podcast(podcastName, messages, [podcastName]);
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
