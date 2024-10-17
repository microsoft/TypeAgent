// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChatTranslator, dateTime, loadSchema } from "typeagent";
import { PromptSection } from "typechat";
import { ChatModel } from "aiclient";
import { AnswerResponse } from "./answerSchema.js";
import { flatten } from "../setOperations.js";
import { SearchResponse } from "./conversation.js";
import registerDebug from "debug";
import { CompositeEntity } from "./entities.js";
import { Action } from "./knowledgeSchema.js";
import { splitLargeTextIntoChunks } from "../textChunker.js";

const answerError = registerDebug("knowledge-processor:answerGenerator:error");

export type AnswerStyle = "List" | "List_Entities" | "Paragraph";

export interface AnswerGenerator {
    settings: AnswerGeneratorSettings;
    generateAnswer(
        question: string,
        style: AnswerStyle | undefined,
        response: SearchResponse,
        higherPrecision: boolean,
    ): Promise<AnswerResponse | undefined>;
}

export type AnswerGeneratorSettings = {
    topKEntities: number;
    maxContextLength?: number | undefined;
    useChunking?: boolean | undefined;
    maxChunkSize?: number | undefined;
};

export function createAnswerGenerator(
    model: ChatModel,
    settings?: AnswerGeneratorSettings,
): AnswerGenerator {
    settings ??= {
        topKEntities: 8,
    };
    const translator = createChatTranslator<AnswerResponse>(
        model,
        loadSchema(["answerSchema.ts"], import.meta.url),
        "AnswerResponse",
    );

    return {
        settings,
        generateAnswer,
    };

    async function generateAnswer(
        question: string,
        style: AnswerStyle | undefined,
        response: SearchResponse,
        higherPrecision: boolean,
    ): Promise<AnswerResponse | undefined> {
        return generateAnswerWithModel(
            question,
            style,
            response,
            higherPrecision,
        );
    }

    async function generateAnswerWithModel(
        question: string,
        answerStyle: AnswerStyle | undefined,
        response: SearchResponse,
        higherPrecision: boolean,
    ): Promise<AnswerResponse | undefined> {
        const maxContextLength = settings?.maxContextLength ?? 1000 * 30;
        const context: any = {
            entities: {
                timeRanges: response.entityTimeRanges(),
                values: response.getCompositeEntities(settings!.topKEntities),
            },
            topics: {
                timeRanges: response.topicTimeRanges(),
                values: response.mergeAllTopics(),
            },
            messages:
                response.messages && response.messages.length > 0
                    ? flatten(response.messages, (m) => {
                          return {
                              timestamp: m.timestamp,
                              value: m.value.value,
                          };
                      })
                    : [],
        };
        const actions = [...response.allActions()];
        if (actions.length > 0) {
            context.actions = {
                timeRanges: response.actionTimeRanges(),
                values: actions,
            };
        }
        let prompt = `The following is a user question about a conversation:\n${question}\n\n`;
        prompt +=
            "Answer the question using only the relevant topics, entities, actions, messages and time ranges/timestamps found in CONVERSATION HISTORY.\n";
        prompt += "Entities and topics are case-insensitive\n";
        if (higherPrecision) {
            prompt +=
                "Don't answer if the topics and entity names/types in the question are not in the conversation history.\n";
        }
        if (answerStyle) {
            prompt += answerStyleToHint(answerStyle);
        } else {
            prompt += "List ALL entities if query intent implies that.\n";
        }
        prompt += `Your answer is readable and complete, with suitable formatting (line breaks, bullet points etc).`;
        // TODO: Switch to using a Prompt Builder here, to avoid truncation
        let contextSection: PromptSection = {
            role: "user",
            content: `[CONVERSATION HISTORY]\n${JSON.stringify(context, undefined, 0)}`,
        };
        if (prompt.length > maxContextLength) {
            prompt = prompt.slice(0, maxContextLength);
            log(
                "generateAnswerWithModel",
                `Prompt exceeds ${maxContextLength} chars. Trimmed.`,
            );
        }
        const result = await translator.translate(prompt, [contextSection]);
        return result.success ? result.data : undefined;
    }

    function answerStyleToHint(answerStyle: AnswerStyle): string {
        switch (answerStyle) {
            default:
                return "";
            case "List":
            case "List_Entities":
                return "List ALL relevant entities";
        }
    }
}

function log(where: string, message: string) {
    const errorText = `${where}\n${message}`;
    answerError(errorText);
}

export type AnswerContextItem<T> = {
    timeRanges: (dateTime.DateRange | undefined)[];
    values: T[];
};

export type AnswerContext = {
    entities?: AnswerContextItem<CompositeEntity> | undefined;
    topics?: AnswerContextItem<string> | undefined;
    actions?: AnswerContextItem<Action> | undefined;
    messages?: dateTime.Timestamped<string>[] | undefined;
};

export function* splitAnswerContext(
    context: AnswerContext,
    maxCharsPerChunk: number,
    autoTrim: boolean = true,
): IterableIterator<AnswerContext> {
    let curChunk: AnswerContext = {};
    let curChunkLength = 0;
    // TODO: split entities, topics, actions
    if (context.entities) {
        curChunk.entities = context.entities;
    }
    if (context.topics) {
        curChunk.topics = context.topics;
    }
    if (context.actions) {
        curChunk.actions = context.actions;
    }
    curChunkLength = stringify(curChunk).length;
    if (curChunkLength >= maxCharsPerChunk) {
        yield curChunk;
        newChunk();
    }
    if (context.messages) {
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
                newChunk();
            }
        }
    }
    if (curChunkLength > 0) {
        yield curChunk;
    }

    function stringify(value: any): string {
        return typeof value === "string" ? value : JSON.stringify(value);
    }

    function newChunk() {
        curChunk = {};
        curChunkLength = 0;
    }
}
