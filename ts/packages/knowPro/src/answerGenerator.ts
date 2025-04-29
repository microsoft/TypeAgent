// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
import { conversation as kpLib } from "knowledge-processor";
import {
    createJsonTranslator,
    error,
    PromptSection,
    Result,
    success,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import * as answerSchema from "./answerResponseSchema.js";
import * as contextSchema from "./answerContextSchema.js";

import { asyncArray, loadSchema, rewriteText } from "typeagent";
import { createTypeScriptJsonValidator } from "typechat/ts";
import {
    IConversation,
    Knowledge,
    MessageOrdinal,
    ScoredMessageOrdinal,
    SemanticRefSearchResult,
} from "./interfaces.js";
import {
    mergedToConcreteEntity,
    mergeScoredConcreteEntities,
    mergeScoredTopics,
} from "./knowledgeMerge.js";
import { getScoredSemanticRefsFromOrdinals } from "./knowledgeLib.js";
import {
    getEnclosingDateRangeForMessages,
    getEnclosingMetadataForMessages,
    getMessagesFromScoredOrdinals,
} from "./message.js";
import { ConversationSearchResult } from "./search.js";
import {
    AnswerContextChunkBuilder,
    answerContextToString,
} from "./answerContext.js";
import { flattenResultsArray, trimStringLength } from "./common.js";

export type AnswerTranslator =
    TypeChatJsonTranslator<answerSchema.AnswerResponse>;

export function createAnswerTranslator(
    model: TypeChatLanguageModel,
): AnswerTranslator {
    const typeName = "AnswerResponse";
    const schema = loadSchema(["answerResponseSchema.ts"], import.meta.url);

    const translator = createJsonTranslator<answerSchema.AnswerResponse>(
        model,
        createTypeScriptJsonValidator<answerSchema.AnswerResponse>(
            schema,
            typeName,
        ),
    );
    return translator;
}

export interface IAnswerGenerator {
    readonly settings: AnswerGeneratorSettings;
    generateAnswer(
        question: string,
        context: contextSchema.AnswerContext | string,
    ): Promise<Result<answerSchema.AnswerResponse>>;
    combinePartialAnswers(
        question: string,
        responses: answerSchema.AnswerResponse[],
    ): Promise<Result<answerSchema.AnswerResponse>>;
}

export async function generateAnswer(
    conversation: IConversation,
    generator: IAnswerGenerator,
    question: string,
    searchResult: ConversationSearchResult,
    progress?: asyncArray.ProcessProgress<
        contextSchema.AnswerContext,
        Result<answerSchema.AnswerResponse>
    >,
): Promise<Result<answerSchema.AnswerResponse>> {
    const context = answerContextFromSearchResult(conversation, searchResult);
    const contextContent = answerContextToString(context);
    if (contextContent.length <= generator.settings.maxCharsInContext) {
        // Context is small enough
        return generator.generateAnswer(question, contextContent);
    }
    //
    // Use chunks
    //
    const chunks = splitContextIntoChunks(
        context,
        generator.settings.maxCharsInContext,
    );
    const chunkResponses = await generateAnswerInChunks(
        generator,
        question,
        chunks,
        generator.settings.concurrency,
        true,
        progress,
    );
    if (!chunkResponses.success) {
        return chunkResponses;
    }
    const answer = await generator.combinePartialAnswers(
        question,
        chunkResponses.data,
    );
    return answer;
}

export type AnswerGeneratorSettings = {
    answerModel: ChatModel;
    rewriteModel: ChatModel; // The rewrite model must not produce JSON output
    maxCharsInContext: number;
    concurrency: number;
};

export class AnswerGenerator implements IAnswerGenerator {
    public settings: AnswerGeneratorSettings;
    private answerTranslator: AnswerTranslator;
    private contextSchema: string;
    private contextTypeName: string;

    constructor(settings?: AnswerGeneratorSettings) {
        this.settings = settings ?? createAnswerGeneratorSettings();
        this.answerTranslator = createAnswerTranslator(
            this.settings.answerModel,
        );
        this.contextSchema = loadSchema(
            ["dateTimeSchema.ts", "answerContextSchema.ts"],
            import.meta.url,
        );
        this.contextTypeName = "AnswerContext";
    }

    public generateAnswer(
        question: string,
        context: contextSchema.AnswerContext | string,
    ): Promise<Result<kpLib.AnswerResponse>> {
        let contextContent =
            typeof context === "string"
                ? context
                : answerContextToString(context);
        if (contextContent.length > this.settings.maxCharsInContext) {
            contextContent = trimStringLength(
                contextContent,
                this.settings.maxCharsInContext,
            );
        }

        const contextPrompt = [
            createContextPrompt(
                this.contextTypeName,
                this.contextSchema,
                contextContent,
            ),
        ];
        const questionPrompt = createQuestionPrompt(question);
        return this.answerTranslator.translate(questionPrompt, contextPrompt);
    }

    public async combinePartialAnswers(
        question: string,
        partialAnswers: (answerSchema.AnswerResponse | undefined)[],
    ): Promise<Result<answerSchema.AnswerResponse>> {
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
                answer = trimStringLength(
                    answer,
                    this.settings.maxCharsInContext,
                );
                const rewrittenAnswer = await rewriteText(
                    this.settings.rewriteModel,
                    answer,
                    question,
                );
                if (!rewrittenAnswer) {
                    return error("rewriteAnswer failed");
                }
                answer = rewrittenAnswer;
            }
            return success({
                type: "Answered",
                answer,
            });
        }
        whyNoAnswer ??= "";
        return success({
            type: "NoAnswer",
            whyNoAnswer,
        });
    }
}

export function createAnswerGeneratorSettings(
    model?: ChatModel,
): AnswerGeneratorSettings {
    return {
        answerModel:
            model ?? openai.createJsonChatModel(undefined, ["answerGenerator"]),
        rewriteModel: openai.createChatModel(),
        maxCharsInContext: 4096 * 4, // 4096 tokens * 4 chars per token,
        concurrency: 2,
    };
}

export function answerContextFromSearchResult(
    conversation: IConversation,
    searchResult: ConversationSearchResult,
) {
    let context: contextSchema.AnswerContext = {};
    for (const knowledgeType of searchResult.knowledgeMatches.keys()) {
        switch (knowledgeType) {
            default:
                break;
            case "entity":
                context.entities = getRelevantEntitiesForAnswer(
                    conversation,
                    searchResult.knowledgeMatches.get(knowledgeType)!,
                );
                break;
            case "topic":
                context.topics = getRelevantTopicsForAnswer(
                    conversation,
                    searchResult.knowledgeMatches.get(knowledgeType)!,
                );
                break;
        }
    }
    if (searchResult.messageMatches && searchResult.messageMatches.length > 0) {
        context.messages = getRelevantMessagesForAnswer(
            conversation,
            searchResult.messageMatches,
        );
    }
    return context;
}

export function getRelevantTopicsForAnswer(
    conversation: IConversation,
    searchResult: SemanticRefSearchResult,
): contextSchema.RelevantKnowledge[] {
    const scoredEntities = getScoredSemanticRefsFromOrdinals(
        conversation.semanticRefs!,
        searchResult.semanticRefMatches,
        "topic",
    );
    const mergedTopics = mergeScoredTopics(scoredEntities, true);
    const relevantTopics: contextSchema.RelevantKnowledge[] = [];
    for (const scoredValue of mergedTopics.values()) {
        let mergedTopic = scoredValue.item;
        const relevantTopic = createRelevantKnowledge(
            conversation,
            mergedTopic.topic,
            mergedTopic.sourceMessageOrdinals,
        );
        relevantTopics.push(relevantTopic);
    }
    return relevantTopics;
}

export function getRelevantEntitiesForAnswer(
    conversation: IConversation,
    searchResult: SemanticRefSearchResult,
): contextSchema.RelevantKnowledge[] {
    const scoredEntities = getScoredSemanticRefsFromOrdinals(
        conversation.semanticRefs!,
        searchResult.semanticRefMatches,
        "entity",
    );
    const mergedEntities = mergeScoredConcreteEntities(scoredEntities, true);
    const relevantEntities: contextSchema.RelevantKnowledge[] = [];
    for (const scoredValue of mergedEntities.values()) {
        let mergedEntity = scoredValue.item;
        const relevantEntity = createRelevantKnowledge(
            conversation,
            mergedToConcreteEntity(mergedEntity),
            mergedEntity.sourceMessageOrdinals,
        );
        relevantEntities.push(relevantEntity);
    }
    return relevantEntities;
}

export function getRelevantMessagesForAnswer(
    conversation: IConversation,
    messageOrdinals: ScoredMessageOrdinal[],
): contextSchema.RelevantMessage[] {
    const relevantMessages: contextSchema.RelevantMessage[] = [];
    for (const message of getMessagesFromScoredOrdinals(
        conversation.messages,
        messageOrdinals,
    )) {
        if (message.textChunks.length === 0) {
            continue;
        }
        const relevantMessage: contextSchema.RelevantMessage = {
            messageText:
                message.textChunks.length === 1
                    ? message.textChunks[0]
                    : message.textChunks,
        };
        const meta = message.metadata;
        if (meta) {
            relevantMessage.from = meta.source;
            relevantMessage.to = meta.dest;
        }
        if (message.timestamp) {
            relevantMessage.timestamp = new Date(message.timestamp);
        }
        relevantMessages.push(relevantMessage);
    }
    return relevantMessages;
}

export function splitContextIntoChunks(
    context: contextSchema.AnswerContext,
    maxCharsPerChunk: number,
): contextSchema.AnswerContext[] {
    const chunkBuilder = new AnswerContextChunkBuilder(
        context,
        maxCharsPerChunk,
    );
    return [...chunkBuilder.getChunks()];
}

export async function generateAnswerInChunks(
    answerGenerator: IAnswerGenerator,
    question: string,
    chunks: contextSchema.AnswerContext[],
    concurrency: number = 2,
    fastStop: boolean = true,
    progress?: asyncArray.ProcessProgress<
        contextSchema.AnswerContext,
        Result<answerSchema.AnswerResponse>
    >,
): Promise<Result<answerSchema.AnswerResponse[]>> {
    if (chunks.length === 0) {
        return success([]);
    }
    if (chunks.length === 1) {
        return runSingleChunk(chunks[0]);
    }

    const structuredChunks = chunks.filter(
        (c) => c.messages === undefined || c.messages.length === 0,
    );
    let chunkAnswers: answerSchema.AnswerResponse[] = [];
    const structuredAnswers = await runGenerateAnswers(
        answerGenerator,
        question,
        structuredChunks,
        concurrency,
        progress,
    );
    if (!structuredAnswers.success) {
        return structuredAnswers;
    }
    chunkAnswers.push(...structuredAnswers.data);

    if (!hasAnswer(chunkAnswers) || !fastStop) {
        // Generate partial answers from each message chunk
        const messageChunks = chunks.filter(
            (c) => c.messages !== undefined && c.messages.length > 0,
        );
        const messageAnswers = await runGenerateAnswers(
            answerGenerator,
            question,
            messageChunks,
            concurrency,
        );
        if (!messageAnswers.success) {
            return messageAnswers;
        }
        chunkAnswers.push(...messageAnswers.data);
    }

    return success(chunkAnswers);

    async function runSingleChunk(
        chunk: contextSchema.AnswerContext,
    ): Promise<Result<answerSchema.AnswerResponse[]>> {
        const response = await answerGenerator.generateAnswer(question, chunk);
        if (progress) {
            progress(chunks[0], 0, response);
        }
        return response.success ? success([response.data]) : response;
    }

    function hasAnswer(answers: answerSchema.AnswerResponse[]): boolean {
        return answers.some((a) => a.type === "Answered");
    }
}

async function runGenerateAnswers(
    answerGenerator: IAnswerGenerator,
    question: string,
    chunks: contextSchema.AnswerContext[],
    concurrency: number,
    progress?: asyncArray.ProcessProgress<
        contextSchema.AnswerContext,
        Result<answerSchema.AnswerResponse>
    >,
): Promise<Result<answerSchema.AnswerResponse[]>> {
    if (chunks.length === 0) {
        return success([]);
    }
    const results = await asyncArray.mapAsync(
        chunks,
        concurrency,
        (chunk) => answerGenerator.generateAnswer(question, chunk),
        (context, index, response) => {
            if (progress) {
                progress(context, index, response);
            }
            if (!response.success) {
                return false;
            }
            // Return false if mapAsync should stop
            return response && response.data.type !== "Answered";
        },
    );
    return flattenResultsArray(results);
}

function createRelevantKnowledge(
    conversation: IConversation,
    knowledge: Knowledge,
    sourceMessageOrdinals?: Iterable<MessageOrdinal>,
): contextSchema.RelevantKnowledge {
    let relevantKnowledge: contextSchema.RelevantKnowledge = {
        knowledge,
    };
    if (sourceMessageOrdinals) {
        relevantKnowledge.timeRange = getEnclosingDateRangeForMessages(
            conversation.messages,
            sourceMessageOrdinals,
        );
        const meta = getEnclosingMetadataForMessages(
            conversation.messages,
            sourceMessageOrdinals,
        );
        if (meta.source) {
            relevantKnowledge.origin = meta.source;
        }
        if (meta.dest) {
            relevantKnowledge.audience = meta.dest;
        }
    }

    return relevantKnowledge;
}

function createQuestionPrompt(question: string): string {
    let prompt: string[] = [
        `The following is a user question:\n===\n${question}\n===\n`, // Leave the '/n' here
        "The included [ANSWER CONTEXT] contains information that MAY be relevant to answering the question.",
        "Answer the question using ONLY relevant topics, entities, actions, messages and time ranges/timestamps found in [ANSWER CONTEXT].",
        "Return 'NoAnswer' if unsure or if the topics and entity names/types in the question are not in the conversation history.",
        "Use the name and type of the provided entities to select those highly relevant to answering the question.",
        "List ALL entities if query intent implies that.",
        "Your answer is readable and complete, with suitable formatting: line breaks, bullet points, numbered lists etc).",
    ];
    return prompt.join("\n");
}

function createContextPrompt(
    typeName: string,
    schema: string,
    context: string,
): PromptSection {
    let content =
        `Context relevant for answering the question is a JSON objects of type ${typeName} according to the following TypeScript definitions :\n` +
        `\`\`\`\n${schema}\`\`\`\n` +
        `[ANSWER CONTEXT]\n` +
        `"""\n${context}\n"""\n`;

    return {
        role: "user",
        content,
    };
}
