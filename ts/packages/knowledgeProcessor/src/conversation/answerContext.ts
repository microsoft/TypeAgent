// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { dateTime } from "typeagent";
import { CompositeEntity } from "./entities.js";
import { ActionGroup } from "./actions.js";
import { splitLargeTextIntoChunks } from "../textChunker.js";

export type AnswerContextItem<T> = {
    timeRanges: (dateTime.DateRange | undefined)[];
    values: T[];
};

export type AnswerContext = {
    entities?: AnswerContextItem<CompositeEntity> | undefined;
    topics?: AnswerContextItem<string> | undefined;
    actions?: AnswerContextItem<ActionGroup> | undefined;
    messages?: dateTime.Timestamped<string>[] | undefined;
};

export function* splitAnswerContext(
    context: AnswerContext,
    maxCharsPerChunk: number,
    splitMessages: boolean = false,
): IterableIterator<AnswerContext> {
    let curChunk = splitStructuredChunks(context);
    let curChunkLength = 0;
    yield curChunk;

    if (context.messages) {
        newChunk();
        if (splitMessages) {
            for (const message of context.messages) {
                for (const messageChunk of splitLargeTextIntoChunks(
                    message.value,
                    maxCharsPerChunk,
                )) {
                    curChunk.messages ??= [];
                    curChunk.messages.push({
                        timestamp: message.timestamp,
                        value: messageChunk,
                    });
                    yield curChunk;
                }
                newChunk();
            }
        } else {
            for (const message of context.messages) {
                if (message.value.length + curChunkLength > maxCharsPerChunk) {
                    if (curChunkLength > 0) {
                        yield curChunk;
                    }
                    newChunk();
                }
                curChunk.messages ??= [];
                curChunk.messages.push(message);
                curChunkLength += message.value.length;
            }
        }
    }
    if (curChunkLength > 0) {
        yield curChunk;
    }

    function newChunk() {
        curChunk = {};
        curChunkLength = 0;
    }
}

export function answerContextToString(context: AnswerContext): string {
    let json = "{\n";
    let propertyCount = 0;
    if (context.entities) {
        json += add("entities", context.entities);
    }
    if (context.topics) {
        json += add("topics", context.topics);
    }
    if (context.actions) {
        json += add("actions", context.actions);
    }
    if (context.messages) {
        json += add("messages", context.messages);
    }
    json += "\n}";
    return json;

    function add(name: string, value: any): string {
        let text = "";
        if (propertyCount > 0) {
            text += ",\n";
        }
        text += `"${name}": ${JSON.stringify(value)}`;
        propertyCount++;
        return text;
    }
}

function splitStructuredChunks(context: AnswerContext): AnswerContext {
    // TODO: split entities, topics, actions

    const chunk: AnswerContext = {};
    if (context.entities) {
        chunk.entities = context.entities;
    }
    if (context.topics) {
        chunk.topics = context.topics;
    }
    if (context.actions) {
        chunk.actions = context.actions;
    }
    return chunk;
}
