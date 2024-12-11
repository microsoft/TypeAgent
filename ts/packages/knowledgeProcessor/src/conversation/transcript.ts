// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { dateTime } from "typeagent";
import { TextBlock, TextBlockType, timestampTextBlocks } from "../text.js";
import { splitIntoLines } from "../textChunker.js";

/**
 * A turn in a transcript
 */
export type TranscriptTurn = {
    speaker: string;
    speech: TextBlock;
};

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
    let turn: TranscriptTurn | undefined;
    for (const line of lines) {
        const match = regex.exec(line);
        if (match && match.groups) {
            const speaker = match.groups["speaker"];
            const speech = match.groups["speech"];
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
    return turns;
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
    return turns.map((t) => {
        if (t.speaker === "None") {
            return t.speech;
        } else {
            return {
                type: t.speech.type,
                value: t.speaker + "\n" + t.speech.value,
            };
        }
    });
}

/**
 * Splits a transcript into timestamped blocks, assigning individual timestamps to blocks
 * that are proportional to their length
 * @param transcript
 * @param startTimestamp
 * @param endTimestamp
 * @returns
 */
export function splitTranscriptIntoTimestampedBlocks(
    transcript: string,
    startTimestamp: Date,
    endTimestamp: Date,
): dateTime.Timestamped<TextBlock>[] {
    const textBlocks = splitTranscriptIntoBlocks(transcript);
    return [
        ...timestampTextBlocks(
            textBlocks,
            transcript.length,
            startTimestamp,
            endTimestamp,
        ),
    ];
}
