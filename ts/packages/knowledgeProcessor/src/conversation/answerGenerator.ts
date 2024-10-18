// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    asyncArray,
    createChatTranslator,
    dateTime,
    loadSchema,
} from "typeagent";
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
    concurrency?: number;
};

export function createAnswerGenerator(
    model: ChatModel,
    generatorSettings?: AnswerGeneratorSettings,
): AnswerGenerator {
    const settings = generatorSettings ?? {
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
        const context: AnswerContext = createContext(response);

        if (isContextTooBig(context, response) && settings.useChunking) {
            // Run answer generation in chunks
            return await getAnswerInChunks(
                question,
                answerStyle,
                higherPrecision,
                context,
            );
        }
        // Context is small enough
        return getAnswer(question, answerStyle, higherPrecision, context);
    }

    async function getAnswer(
        question: string,
        answerStyle: AnswerStyle | undefined,
        higherPrecision: boolean,
        context: AnswerContext,
    ): Promise<AnswerResponse | undefined> {
        let contextContent = answerContextToString(context);
        if (contextContent.length > getMaxContextLength()) {
            contextContent = trimContext(contextContent, getMaxContextLength());
        }
        const contextSection: PromptSection = {
            role: "user",
            content: `[CONVERSATION HISTORY]\n${contextContent}`,
        };

        const prompt = createAnswerPrompt(
            question,
            higherPrecision,
            answerStyle,
        );
        const result = await translator.translate(prompt, [contextSection]);
        return result.success ? result.data : undefined;
    }

    async function getAnswerInChunks(
        question: string,
        answerStyle: AnswerStyle | undefined,
        higherPrecision: boolean,
        context: AnswerContext,
    ): Promise<AnswerResponse | undefined> {
        const chunks = [
            ...splitAnswerContext(context, settings.maxContextLength!),
        ];
        const partialAnswers = await asyncArray.mapAsync(
            chunks,
            settings.concurrency ?? 2,
            (chunk) => getAnswer(question, answerStyle, higherPrecision, chunk),
        );
        let answer = "";
        let whyNoAnswer: string | undefined;
        for (const partialAnswer of partialAnswers) {
            if (partialAnswer) {
                if (partialAnswer.type === "Answered") {
                    answer += partialAnswer.answer;
                } else {
                    whyNoAnswer ??= partialAnswer.whyNoAnswer;
                }
            }
        }
        if (answer.length > 0) {
            return {
                type: "Answered",
                answer,
            };
        }
        whyNoAnswer ??= "";
        return {
            type: "NoAnswer",
            whyNoAnswer,
        };
    }

    function createAnswerPrompt(
        question: string,
        higherPrecision: boolean,
        answerStyle: AnswerStyle | undefined,
    ): string {
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
        return prompt;
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

    function createContext(response: SearchResponse) {
        const context: AnswerContext = {
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
        return context;
    }

    function trimContext(content: string, maxLength: number): string {
        if (content.length > maxLength) {
            content = content.slice(0, maxLength);
            log(
                "generateAnswerWithModel",
                `Context exceeds ${maxLength} chars. Trimmed.`,
            );
        }
        return content;
    }

    function isContextTooBig(context: AnswerContext, response: SearchResponse) {
        const totalMessageLength = response.getTotalMessageLength();
        return totalMessageLength > getMaxContextLength();
    }

    function getMaxContextLength(): number {
        return settings?.maxContextLength ?? 1000 * 30;
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
    splitMessages: boolean = false,
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
    curChunkLength = answerContextToString(curChunk).length;
    if (curChunkLength >= maxCharsPerChunk) {
        yield curChunk;
        newChunk();
    }
    if (context.messages) {
        for (const message of context.messages) {
            if (splitMessages) {
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
            } else {
                curChunk.messages ??= [];
                curChunk.messages.push(message);
                yield curChunk;
            }
            newChunk();
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
