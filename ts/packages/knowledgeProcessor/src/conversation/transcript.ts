// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    asyncArray,
    cleanDir,
    dateTime,
    ensureDir,
    getFileName,
    readAllText,
    readJsonFile,
    writeJsonFile,
    writeJsonFiles,
} from "typeagent";
import { TextBlock, TextBlockType } from "../text.js";
import { split, splitIntoLines } from "../textChunker.js";
import {
    ConversationManager,
    ConversationMessage,
} from "./conversationManager.js";
import { Action, KnowledgeResponse } from "./knowledgeSchema.js";
import { DateTimeRange } from "./dateTimeSchema.js";
import { dateToDateTime } from "./knowledgeActions.js";
import { AliasMatcher } from "../textMatcher.js";
import path from "path";

export type TranscriptMetadata = {
    sourcePath: string;
    name: string;
    description?: string | undefined;
    startAt?: string | undefined; // Should be parsable as a Date
    lengthMinutes?: number | undefined;
};

export type Transcript = {
    metadata: TranscriptMetadata;
    turns: TranscriptTurn[];
};

export async function createTranscript(
    transcriptFilePath: string,
    name: string,
    description: string,
    startAt: string,
    lengthMinutes: number,
): Promise<Transcript> {
    const turns = await loadTurnsFromTranscriptFile(transcriptFilePath);
    const transcript = {
        turns,
        metadata: {
            sourcePath: transcriptFilePath,
            name,
            description,
            startAt,
            lengthMinutes,
        },
    };
    dateTime.stringToDate;
    const startTimestamp = new Date(startAt);
    if (!startTimestamp) {
        throw new Error("Invalid startAt");
    }
    const endTimestamp = dateTime.addMinutesToDate(
        startTimestamp,
        lengthMinutes,
    );
    timestampTranscriptTurns(transcript.turns, startTimestamp, endTimestamp);
    return transcript;
}

export async function importTranscript(
    transcriptFilePath: string,
    name: string,
    description: string,
    startAt: string,
    lengthMinutes: number,
    clean: boolean = true,
) {
    const transcript = await createTranscript(
        transcriptFilePath,
        name,
        description,
        startAt,
        lengthMinutes,
    );
    const transcriptFileName = getFileName(transcriptFilePath);
    const destFolderPath = path.join(
        path.dirname(transcriptFilePath),
        transcriptFileName,
    );
    await saveTranscriptToFolder(
        transcript,
        destFolderPath,
        transcriptFileName,
    );
    return transcript;
}

export async function saveTranscriptToFolder(
    transcript: Transcript,
    destPath: string,
    baseTurnFileName: string,
    clean: boolean = true,
): Promise<void> {
    const metadataPath = path.join(destPath, "metadata.json");
    const turnsPath = path.join(destPath, "turns");
    if (clean) {
        await cleanDir(destPath);
    }
    await ensureDir(turnsPath);
    await writeJsonFile(metadataPath, transcript.metadata);
    await saveTranscriptTurnsToFolder(
        turnsPath,
        baseTurnFileName,
        transcript.turns,
    );
}

/**
 * A turn in a transcript
 */
export type TranscriptTurn = {
    speaker: string;
    listeners?: string[] | undefined;
    speech: TextBlock;
    timestamp?: string | undefined;
};

/**
 * Converts a turn from a transcript into a conversation message
 * @param turn
 * @returns
 */
export function transcriptTurnToMessage(
    turn: TranscriptTurn,
): ConversationMessage {
    return {
        sender: getSpeaker(turn),
        recipients: turn.listeners,
        text: getMessageText(turn, true),
        timestamp: dateTime.stringToDate(turn.timestamp),
        knowledge: transcriptTurnToKnowledge(turn),
    };
}

enum TurnVerbs {
    say = "say",
}

function transcriptTurnToKnowledge(turn: TranscriptTurn): KnowledgeResponse {
    return {
        entities: [],
        actions: transcriptTurnToActions(turn),
        inverseActions: [],
        topics: [],
    };
}

function transcriptTurnToActions(turn: TranscriptTurn): Action[] {
    const actions: Action[] = [];
    if (turn.speaker && turn.listeners) {
        for (const listener of turn.listeners) {
            actions.push(createAction(TurnVerbs.say, turn.speaker, listener));
        }
    }
    return actions;
}

function createAction(verb: string, from: string, to: string): Action {
    return {
        verbs: [verb],
        verbTense: "past",
        subjectEntityName: from,
        objectEntityName: "none",
        indirectObjectEntityName: to,
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

export async function saveTranscriptTurnsToFolder(
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
    await addTranscriptTurnAliases(cm, turns);
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
        text += `From: ${turn.speaker}\n`;
    }
    if (turn.listeners && turn.listeners.length > 0) {
        text += `To: ${turn.listeners.join(", ")}\n`;
    }
    return text;
}

export function createTranscriptOverview(
    metadata: TranscriptMetadata,
    turns: TranscriptTurn[],
): string {
    let participantSet = getTranscriptParticipants(turns);
    let overview = metadata.name;
    if (metadata.description) {
        overview += "\n";
        overview += metadata.description;
    }
    const participants = [...participantSet.values()];
    if (participants.length > 0) {
        overview += "\nParticipants:\n";
        overview += participants.join(", ");
    }
    return overview;
}

export function getTranscriptParticipants(
    turns: TranscriptTurn[],
): Set<string> {
    let participantSet = new Set<string>();
    for (const turn of turns) {
        let speaker = getSpeaker(turn);
        if (speaker) {
            participantSet.add(speaker);
        }
        if (turn.listeners && turn.listeners.length > 0) {
            for (const listener of turn.listeners) {
                participantSet.add(listener);
            }
        }
    }
    return participantSet;
}

export function getTranscriptTags(turns: TranscriptTurn[]): string[] {
    const participants = getTranscriptParticipants(turns);
    const tags = new Set<string>();
    for (const p of participants.values()) {
        tags.add(p);
        const nameTags = splitParticipantName(p);
        if (nameTags) {
            tags.add(nameTags.firstName);
        }
    }
    return [...tags.values()];
}

export function parseTranscriptDuration(
    startAt: string,
    lengthMinutes: number,
): DateTimeRange {
    const startDate = dateTime.stringToDate(startAt)!;
    const offsetMs = lengthMinutes * 60 * 1000;
    const stopDate = new Date(startDate.getTime() + offsetMs);
    return {
        startDate: dateToDateTime(startDate),
        stopDate: dateToDateTime(stopDate),
    };
}

export type ParticipantName = {
    firstName: string;
    lastName?: string | undefined;
    middleName?: string | undefined;
};

export function splitParticipantName(
    fullName: string,
): ParticipantName | undefined {
    const parts = split(fullName, /\s+/, {
        trim: true,
        removeEmpty: true,
    });
    switch (parts.length) {
        case 0:
            return undefined;
        case 1:
            return { firstName: parts[0] };
        case 2:
            return { firstName: parts[0], lastName: parts[1] };
        case 3:
            return {
                firstName: parts[0],
                middleName: parts[1],
                lastName: parts[2],
            };
    }
}

export async function addTranscriptTurnAliases(
    cm: ConversationManager,
    turns: TranscriptTurn | TranscriptTurn[],
) {
    const aliases = (await cm.conversation.getEntityIndex()).nameAliases;
    if (Array.isArray(turns)) {
        await asyncArray.forEachAsync(turns, 1, (t) =>
            addListenersAlias(aliases, t.listeners),
        );
    } else {
        await addListenersAlias(aliases, turns.listeners);
    }
}

async function addListenersAlias(
    aliases: AliasMatcher,
    listeners: string[] | undefined,
) {
    if (listeners && listeners.length > 0) {
        await asyncArray.forEachAsync(listeners, 1, async (listener) => {
            const parts = splitParticipantName(listener);
            if (parts && parts.firstName) {
                await aliases.addAlias(parts.firstName, listener);
            }
        });
    }
}
