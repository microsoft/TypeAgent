// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { dateTime, readAllText, readJsonFile, writeJsonFiles } from "typeagent";
import { TextBlock, TextBlockType } from "../text.js";
import { splitIntoLines } from "../textChunker.js";
import {
    ConversationManager,
    ConversationMessage,
} from "./conversationManager.js";

/**
 * A turn in a transcript
 */
export type TranscriptTurn = {
    speaker: string;
    listeners?: string[] | undefined;
    speech: TextBlock;
    timestamp?: string | undefined;
};

export function transcriptTurnToMessage(
    turn: TranscriptTurn,
): ConversationMessage {
    return {
        sender: getSpeaker(turn),
        text: getMessageText(turn, true),
        timestamp: dateTime.stringToDate(turn.timestamp),
    };
}

/**
 * A transcript of a conversation contains turns. Splits a transcript file into individual turns
 * Each turn is a paragraph prefixed by the name of the speaker and is followed by speaker text.
 * Example of a turn:
 *   Macbeth:
 *   Tomorrow and tomorrow and tomorrow...
 *
 */
export function splitTranscriptIntoTurns(transcript: string): TranscriptTurn[] {
    transcript = transcript.trim();
    if (!transcript) {
        return [];
    }
    const lines = splitIntoLines(transcript, { trim: true, removeEmpty: true });

    const regex = /^(?<speaker>[A-Z0-9 ]+:)?(?<speech>.*)$/;
    const turns: TranscriptTurn[] = [];
    const participants = new Set<string>();
    let turn: TranscriptTurn | undefined;
    for (const line of lines) {
        const match = regex.exec(line);
        if (match && match.groups) {
            let speaker = match.groups["speaker"];
            let speech = match.groups["speech"];
            if (turn) {
                if (speaker) {
                    turns.push(turn);
                    turn = undefined;
                } else {
                    // Existing turn
                    turn.speech.value += "\n" + speech;
                }
            }
            if (!turn) {
                if (speaker) {
                    speaker = speaker.trim();
                    if (speaker.endsWith(":")) {
                        speaker = speaker.slice(0, speaker.length - 1);
                    }
                    speaker = speaker.toUpperCase();
                    participants.add(speaker);
                }
                turn = {
                    speaker: speaker ?? "None",
                    speech: {
                        value: speech,
                        type: TextBlockType.Paragraph,
                    },
                };
            }
        }
    }
    if (turn) {
        turns.push(turn);
    }
    assignTurnListeners(turns, participants);
    return turns;
}

/**
 * Load turns from a transcript file
 * @param filePath
 * @returns
 */
export async function loadTurnsFromTranscriptFile(
    filePath: string,
): Promise<TranscriptTurn[]> {
    const turns = splitTranscriptIntoTurns(await readAllText(filePath));
    const sourceId = [filePath];
    turns.forEach((t) => (t.speech.sourceIds = sourceId));
    return turns;
}

/**
 * Load a transcript turn
 * @param filePath
 * @returns
 */
export async function loadTranscriptTurn(
    filePath: string,
): Promise<TranscriptTurn | undefined> {
    return readJsonFile<TranscriptTurn>(filePath);
}

export async function saveTranscriptTurns(
    destFolderPath: string,
    baseFileName: string,
    turns: TranscriptTurn[],
) {
    await writeJsonFiles(destFolderPath, baseFileName, turns);
}

/**
 * Text (such as a transcript) can be collected over a time range.
 * This text can be partitioned into blocks. However, timestamps for individual blocks are not available.
 * Assigns individual timestamps to blocks proportional to their lengths.
 * @param turns Transcript turns to assign timestamps to
 * @param startTimestamp starting
 * @param endTimestamp
 */
export function timestampTranscriptTurns(
    turns: TranscriptTurn[],
    startTimestamp: Date,
    endTimestamp: Date,
): void {
    let startTicks = startTimestamp.getTime();
    const ticksLength = endTimestamp.getTime() - startTicks;
    if (ticksLength <= 0) {
        throw new Error(`${startTimestamp} is not < ${endTimestamp}`);
    }
    const textLength: number = turns.reduce(
        (total: number, t) => total + t.speech.value.length,
        0,
    );
    const ticksPerChar = ticksLength / textLength;
    for (let turn of turns) {
        turn.timestamp = new Date(startTicks).toISOString();
        // Now, we will 'elapse' time .. proportional to length of the text
        // This assumes that each speaker speaks equally fast...
        startTicks += ticksPerChar * turn.speech.value.length;
    }
}

/**
 * Splits a transcript into text blocks.
 * Each block:
 * - The speaker (if any)
 * - What the speaker said
 * @param transcript
 * @returns array of text blocks
 */
export function splitTranscriptIntoBlocks(transcript: string): TextBlock[] {
    const turns = splitTranscriptIntoTurns(transcript);
    return turns.map((t) => getMessageText(t, false));
}

export async function addTranscriptTurnsToConversation(
    cm: ConversationManager,
    turns: TranscriptTurn | TranscriptTurn[],
): Promise<void> {
    const messages: ConversationMessage[] = [];
    if (Array.isArray(turns)) {
        for (const turn of turns) {
            messages.push(transcriptTurnToMessage(turn));
        }
    } else {
        messages.push(transcriptTurnToMessage(turns));
    }
    await cm.addMessageBatch(messages);
}

function assignTurnListeners(
    turns: TranscriptTurn[],
    participants: Set<string>,
) {
    for (const turn of turns) {
        const speaker = getSpeaker(turn);
        if (speaker) {
            let listeners: string[] = [];
            for (const p of participants) {
                if (p !== speaker) {
                    listeners.push(p);
                }
            }
            turn.listeners = listeners;
        }
    }
}

function getSpeaker(t: TranscriptTurn) {
    return t.speaker === "None" ? undefined : t.speaker;
}

function getMessageText(t: TranscriptTurn, includeHeader: boolean) {
    t.speech.value = t.speech.value.trim();
    if (t.speaker === "None") {
        return t.speech;
    } else if (!includeHeader) {
        return {
            type: t.speech.type,
            value: t.speaker + ":\n" + t.speech.value,
        };
    } else {
        const header = turnToHeaderString(t);
        return {
            type: t.speech.type,
            value: header + t.speech.value,
        };
    }
}

function turnToHeaderString(turn: TranscriptTurn): string {
    let text = "";
    if (turn.speaker) {
        text += `"From: ${turn.speaker}\n`;
    }
    if (turn.listeners && turn.listeners.length > 0) {
        text += `To: ${turn.listeners.join(", ")}\n"`;
    }
    return text;
}
