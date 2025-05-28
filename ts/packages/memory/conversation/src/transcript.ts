// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import * as kpLib from "knowledge-processor";
import { IMessage } from "knowpro";
//import { WebVTTParser } from "webvtt-parser";
import * as vtt from "webvtt-parser";

import vttpgk from "webvtt-parser";
const { WebVTTParser } = vttpgk;
/**
 * INTERNAL LIBRARY
 * Should not be exposed via index.ts
 */

export interface ITranscriptMessage extends IMessage {
    addContent(text: string): void;
}

/**
 * Parses transcript text consisting of turns in a conversation.
 * Turn are in the format:
 *  SPEAKER_NAME: TEXT
 *  SPEAKER_NAME:
 *  TEXT
 */
export function parseTranscript<TMessage extends ITranscriptMessage>(
    transcriptText: string,
    messageFactory: (speaker: string, text: string) => TMessage,
): [TMessage[], Set<string>] {
    const turnParserRegex = /^(?<speaker>[A-Z0-9 ]+:)?(?<speech>.*)$/;
    const transcriptLines = getTranscriptLines(transcriptText);
    const participants = new Set<string>();
    const messages: TMessage[] = [];
    let curMsg: TMessage | undefined = undefined;

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
                curMsg = messageFactory(speaker, speech);
            }
        }
    }
    if (curMsg) {
        messages.push(curMsg);
    }
    return [messages, participants];
}

export function getTranscriptLines(
    transcriptText: string,
    removeEmpty: boolean = true,
): string[] {
    return kpLib.split(transcriptText, /\r?\n/, {
        removeEmpty,
        trim: true,
    });
}

export function prepareSpeakerName(speaker: string): string {
    speaker = speaker.trim();
    if (speaker.endsWith(":")) {
        speaker = speaker.slice(0, speaker.length - 1);
    }
    speaker = speaker.toLocaleLowerCase();
    return speaker;
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

export function parseVttTranscript<TMessage extends ITranscriptMessage>(
    transcriptText: string,
    messageFactory: (speaker: string) => TMessage,
    startAt?: Date,
): [TMessage[], Set<string>] {
    const parser = new VttParser(startAt ?? new Date(), messageFactory);
    return parser.parse(transcriptText);
}

class VttParser<TMessage extends ITranscriptMessage> {
    private parser: vtt.WebVTTParser;
    private messages: TMessage[];
    private participants: Set<string>;
    private curSpeaker: string = "";
    private curMsg: TMessage | undefined;
    private curOffsetSeconds: number | undefined;

    constructor(
        public startDate: Date,
        public messageFactory: (speaker: string) => TMessage,
    ) {
        this.parser = new WebVTTParser();
        this.messages = [];
        this.participants = new Set<string>();
    }

    public parse(transcriptText: string): [TMessage[], Set<string>] {
        const vttData: vtt.VTTData = this.parser.parse(transcriptText);
        this.curSpeaker = "unknown";
        for (const cue of vttData.cues) {
            this.parseCue(cue);
        }
        this.completeMessage();
        return [this.messages, this.participants];
    }

    public clear() {
        this.messages = [];
        this.participants = new Set<string>();
        this.curMsg = undefined;
        this.curSpeaker = "unknown";
        this.curOffsetSeconds = undefined;
    }

    private parseCue(cue: vtt.Cue) {
        this.curOffsetSeconds = cue.startTime;
        for (const node of cue.tree.children) {
            if (node.type === "object") {
                switch (node.name) {
                    default:
                        break;

                    case "v":
                        const speaker = node.value;
                        if (speaker !== this.curSpeaker) {
                            this.completeMessage();
                            this.startSpeaker(speaker);
                        }
                        this.ensureMessageStarted();
                        this.parseInternalText(node);
                        break;
                }
            } else if (node.type === "text") {
                this.ensureMessageStarted();
                this.appendMessageText(node.value);
            }
        }
    }

    private parseInternalText(node: any): void {
        for (const childNode of node.children) {
            if (childNode.type === "object") {
                this.parseInternalText(childNode);
            } else if (childNode.type === "text") {
                this.appendMessageText(childNode.value);
            }
        }
    }

    private appendMessageText(text: string): void {
        if (this.curMsg !== undefined) {
            if (this.curMsg.textChunks.length > 0) {
                this.curMsg.addContent(" ");
            }
            this.curMsg.addContent(text.trim());
        }
    }

    private startSpeaker(speaker: string): void {
        this.curSpeaker = speaker;
        this.participants.add(speaker);
    }

    private ensureMessageStarted(): TMessage {
        return this.curMsg === undefined ? this.startMessage() : this.curMsg;
    }

    private startMessage(): TMessage {
        this.curMsg = this.messageFactory(this.curSpeaker);
        if (this.curOffsetSeconds !== undefined) {
            this.curMsg.timestamp = this.makeTimestamp(this.curOffsetSeconds);
        }
        return this.curMsg;
    }

    private completeMessage() {
        if (this.curMsg !== undefined) {
            this.messages.push(this.curMsg);
            this.curMsg = undefined;
        }
    }

    private makeTimestamp(offsetSeconds: number): string {
        const dt = new Date(this.startDate.getTime() + offsetSeconds * 1000);
        return dt.toISOString();
    }
}
