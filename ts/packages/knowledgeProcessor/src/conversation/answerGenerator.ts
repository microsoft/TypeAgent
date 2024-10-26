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
import { SearchResponse, TopKSettings } from "./searchResponse.js";
import registerDebug from "debug";
import { CompositeEntity } from "./entities.js";
import { splitLargeTextIntoChunks } from "../textChunker.js";
import { ActionGroup } from "./actions.js";

const answerError = registerDebug("knowledge-processor:answerGenerator:error");

export type AnswerStyle = "List" | "List_Entities" | "Paragraph";

export type AnswerSettings = {
    maxCharsPerChunk: number;
    answerStyle: AnswerStyle | undefined;
    higherPrecision: boolean;
};

export type AnswerChunkingSettings = {
    enable: boolean;
    splitMessages?: boolean | undefined;
    maxChunks?: number | undefined;
    fastStop?: boolean | undefined;
};

export type AnswerGeneratorSettings = {
    topK: TopKSettings;
    chunking: AnswerChunkingSettings;
    maxCharsInContext?: number | undefined;
    concurrency?: number;
    hints?: string | undefined;
};

export function createAnswerGeneratorSettings(): AnswerGeneratorSettings {
    return {
        topK: {
            topicsTopK: 8,
            entitiesTopK: 8,
            actionsTopK: 0,
        },
        chunking: {
            enable: false,
            splitMessages: false,
            fastStop: true,
        },
        maxCharsInContext: 1024 * 8,
    };
}

export interface AnswerGenerator {
    settings: AnswerGeneratorSettings;
    generateAnswer(
        question: string,
        style: AnswerStyle | undefined,
        response: SearchResponse,
        higherPrecision: boolean,
    ): Promise<AnswerResponse | undefined>;
    generateAnswerInChunks(
        question: string,
        response: SearchResponse,
        settings: AnswerSettings,
        progress?: asyncArray.ProcessProgress<
            AnswerContext,
            AnswerResponse | undefined
        >,
    ): Promise<AnswerResponse | undefined>;
}

export function createAnswerGenerator(
    model: ChatModel,
    generatorSettings?: AnswerGeneratorSettings,
): AnswerGenerator {
    const settings = generatorSettings ?? createAnswerGeneratorSettings();
    const translator = createChatTranslator<AnswerResponse>(
        model,
        loadSchema(["answerSchema.ts"], import.meta.url),
        "AnswerResponse",
    );

    return {
        get settings() {
            return settings;
        },
        generateAnswer,
        generateAnswerInChunks,
    };

    async function generateAnswerInChunks(
        question: string,
        response: SearchResponse,
        settings: AnswerSettings,
        progress?: asyncArray.ProcessProgress<
            AnswerContext,
            AnswerResponse | undefined
        >,
    ): Promise<AnswerResponse | undefined> {
        const context: AnswerContext = createContext(response);
        return getAnswerInChunks(question, context, settings, progress);
    }

    async function generateAnswer(
        question: string,
        answerStyle: AnswerStyle | undefined,
        response: SearchResponse,
        higherPrecision: boolean,
    ): Promise<AnswerResponse | undefined> {
        const context: AnswerContext = createContext(response);

        if (isContextTooBig(context, response) && settings.chunking?.enable) {
            // Run answer generation in chunks
            return await getAnswerInChunks(question, context, {
                maxCharsPerChunk: settings.maxCharsInContext!,
                answerStyle,
                higherPrecision,
            });
        }
        // Context is small enough
        return getAnswer(question, answerStyle, higherPrecision, context);
    }

    async function getAnswerInChunks(
        question: string,
        context: AnswerContext,
        answerSettings: AnswerSettings,
        progress?: asyncArray.ProcessProgress<
            AnswerContext,
            AnswerResponse | undefined
        >,
    ): Promise<AnswerResponse | undefined> {
        let chunks = splitContext(context, answerSettings.maxCharsPerChunk);
        if (chunks.length === 0) {
            return undefined;
        }
        if (!chunks[0].messages) {
            const structuredChunk = chunks[0];
            // Structured only. Lets do it first, since it may have the full answer we needed
            const structuredAnswer = await getAnswer(
                question,
                answerSettings.answerStyle,
                answerSettings.higherPrecision,
                structuredChunk,
                false,
            );
            if (structuredAnswer && structuredAnswer.type === "Answered") {
                return structuredAnswer;
            }
            chunks = chunks.slice(1);
        }
        if (chunks.length === 0) {
            return undefined;
        }
        // Generate partial answers from each chunk
        const partialAnswers = await asyncArray.mapAsync(
            chunks,
            settings.concurrency ?? 2,
            (chunk) =>
                getAnswer(
                    question,
                    answerSettings.answerStyle,
                    answerSettings.higherPrecision,
                    chunk,
                    false,
                ),
            (context, index, response) => {
                if (progress) {
                    progress(context, index, response);
                }
                if (settings.chunking.fastStop) {
                    // Return false if mapAsync should stop
                    return response && response.type !== "Answered";
                }
            },
        );

        return await combinePartialAnswers(question, partialAnswers);
    }

    async function getAnswer(
        question: string,
        answerStyle: AnswerStyle | undefined,
        higherPrecision: boolean,
        context: AnswerContext,
        trim: boolean = true,
    ): Promise<AnswerResponse | undefined> {
        // Currently always use a model to transform the search response into an answer
        // Future: some answers may be rendered using local templates, code etc.
        let contextContent = answerContextToString(context);
        if (trim && contextContent.length > getMaxContextLength()) {
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

    async function combinePartialAnswers(
        question: string,
        partialAnswers: (AnswerResponse | undefined)[],
    ): Promise<AnswerResponse> {
        let answer = "";
        let whyNoAnswer: string | undefined;
        let answerCount = 0;
        for (const partialAnswer of partialAnswers) {
            if (partialAnswer) {
                if (partialAnswer.type === "Answered") {
                    answerCount++;
                    answer += partialAnswer.answer + "\n";
                } else {
                    whyNoAnswer ??= partialAnswer.whyNoAnswer;
                }
            }
        }
        if (answer.length > 0) {
            if (answerCount > 1) {
                answer = (await rewriteAnswer(question, answer)) ?? answer;
            }
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

    async function rewriteAnswer(
        question: string,
        text: string,
    ): Promise<string | undefined> {
        text = trim(text, settings.maxCharsInContext);
        let prompt = `The following text answers the QUESTION "${question}".`;
        prompt +=
            " Rewrite it to remove all redundancy, duplication, contradiction, or anything that does not answer the question.";
        prompt += "\nImprove formatting";
        prompt += `\n"""\n${text}\n"""\n`;
        const result = await model.complete(prompt);
        if (result.success) {
            return result.data;
        }

        return undefined;
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
        if (settings.hints) {
            prompt += "\n" + settings.hints;
        }
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
                values: response.getEntities(settings.topK.entitiesTopK),
            },
            topics: {
                timeRanges: response.topicTimeRanges(),
                values: response.getTopics(),
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
        if (settings.topK.actionsTopK > 0 && response.hasActions()) {
            const actions = response.getActions(settings.topK.actionsTopK);
            if (actions.length > 0) {
                context.actions = {
                    timeRanges: response.actionTimeRanges(),
                    values: response.getActions(settings.topK.actionsTopK),
                };
            }
        }
        return context;
    }

    function splitContext(context: AnswerContext, maxCharsPerChunk: number) {
        let chunks = [...splitAnswerContext(context, maxCharsPerChunk)];
        const maxChunks = settings.chunking.maxChunks;
        if (maxChunks && maxChunks > 0) {
            chunks = chunks.slice(0, maxChunks);
        }
        return chunks;
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

    function trim(text: string, maxLength: number | undefined): string {
        if (maxLength && text.length > maxLength) {
            return text.slice(0, maxLength);
        }
        return text;
    }

    function isContextTooBig(context: AnswerContext, response: SearchResponse) {
        const totalMessageLength = response.getTotalMessageLength();
        return totalMessageLength > getMaxContextLength();
    }

    function getMaxContextLength(): number {
        return settings?.maxCharsInContext ?? 1000 * 20;
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
