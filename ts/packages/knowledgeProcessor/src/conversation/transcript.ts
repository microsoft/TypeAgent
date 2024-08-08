// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextBlock, TextBlockType } from "../text.js";
import { splitIntoLines } from "../textChunker.js";

export type Turn = {
    speaker: string;
    speech: TextBlock;
};

export function splitTranscriptIntoTurns(transcript: string): Turn[] {
    const lines = splitIntoLines(transcript, { trim: true, removeEmpty: true });

    const regex = /^(?<speaker>[A-Z0-9 ]+:)?(?<speech>.*)$/;
    const turns: Turn[] = [];
    let turn: Turn | undefined;
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
