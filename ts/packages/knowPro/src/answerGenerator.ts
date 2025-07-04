// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
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
import { asyncArray, getTopK, loadSchema, rewriteText } from "typeagent";
import { createTypeScriptJsonValidator } from "typechat/ts";
import {
    IConversation,
    Knowledge,
    MessageOrdinal,
    ScoredMessageOrdinal,
    SemanticRefSearchResult,
} from "./interfaces.js";
import {
    MergedEntity,
    mergedToConcreteEntity,
    MergedTopic,
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
    AnswerContextOptions,
    answerContextToString,
} from "./answerContext.js";
import { flattenResultsArray, Scored, trimStringLength } from "./common.js";
import { createMultipleChoiceQuestion } from "./searchLib.js";

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

/**
 * Generates answers to questions using provided AnswerContext
 */
export interface IAnswerGenerator {
    /**
     * Settings for this answer generator
     */
    readonly settings: AnswerGeneratorSettings;
    /**
     * Generate an answer
     * @param question
     * @param context
     */
    generateAnswer(
        question: string,
        context: contextSchema.AnswerContext | string,
    ): Promise<Result<answerSchema.AnswerResponse>>;
    /**
     * Answers can be generated in parts, if the context is bigger than a character budget
     * @param question
     * @param responses
     */
    combinePartialAnswers(
        question: string,
        responses: answerSchema.AnswerResponse[],
    ): Promise<Result<answerSchema.AnswerResponse>>;
}

/**
 * Settings for answer generation
 */
export type AnswerGeneratorSettings = {
    /**
     * Model used to generate answers from context
     */
    answerGeneratorModel: ChatModel;
    /**
     * The Answer Generator can combine multiple partial answers which
     * can be produced by sending chunks of the relevant context to the model in parallel
     * These partial answers may be combined using the 'combinePartialAnswers' call.
     * Implementations use the "rewriteModel"
     */
    answerCombinerModel: ChatModel;
    /**
     * Maximum number of characters allowed in the context for any given call
     */
    maxCharsInBudget: number;
    /**
     * When chunking, produce answer in parallel
     */
    concurrency: number;
    /**
     * Stop processing if answer found using just knowledge
     */
    fastStop: boolean;
    /**
     * Additional instructions for the model
     */
    modelInstructions?: PromptSection[] | undefined;
    includeContextSchema?: boolean | undefined;
};

/**
 * Generate a natural language answer for question about a conversation using the provided search results as context
 *  - Each search result is first turned into an answer individually
 *  - If more than one search result provided, then individual answers are combined into a single answer
 * If the context exceeds the generator.setting.maxCharsInBudget, will break up the context into
 * chunks, run them in parallel, and then merge the answers found in individual chunks
 * @param conversation conversation about which this is a question
 * @param generator answer generator to use to turn search results onto language answers: @see AnswerGenerator
 * @param question question that was asked
 * @param searchResults the results of running a search query for the question on the conversation
 * @param progress Progress callback
 * @returns Answers
 */
export async function generateAnswer(
    conversation: IConversation,
    generator: IAnswerGenerator,
    question: string,
    searchResults: ConversationSearchResult | ConversationSearchResult[],
    progress?: asyncArray.ProcessProgress<
        contextSchema.AnswerContext,
        Result<answerSchema.AnswerResponse>
    >,
    contextOptions?: AnswerContextOptions,
): Promise<Result<answerSchema.AnswerResponse>> {
    let answerResponse: Result<answerSchema.AnswerResponse>;
    if (!Array.isArray(searchResults)) {
        answerResponse = await generateAnswerFromSearchResult(
            conversation,
            generator,
            question,
            searchResults,
            progress,
            contextOptions,
        );
    } else {
        if (searchResults.length === 0) {
            return error("No search results");
        }
        if (searchResults.length === 1) {
            answerResponse = await generateAnswerFromSearchResult(
                conversation,
                generator,
                question,
                searchResults[0],
                progress,
                contextOptions,
            );
        } else {
            // Get answers for individual searches in parallel
            const partialResults = await asyncArray.mapAsync(
                searchResults,
                generator.settings.concurrency,
                (sr) =>
                    generateAnswerFromSearchResult(
                        conversation,
                        generator,
                        question,
                        sr,
                        progress,
                        contextOptions,
                    ),
            );
            // Use partial responses to build a complete answer
            const partialResponses: answerSchema.AnswerResponse[] = [];
            for (const result of partialResults) {
                if (!result.success) {
                    return result;
                }
                partialResponses.push(result.data);
            }
            answerResponse = await generator.combinePartialAnswers(
                question,
                partialResponses,
            );
        }
    }
    return answerResponse;
}

async function generateAnswerFromSearchResult(
    conversation: IConversation,
    generator: IAnswerGenerator,
    question: string,
    searchResult: ConversationSearchResult,
    progress?: asyncArray.ProcessProgress<
        contextSchema.AnswerContext,
        Result<answerSchema.AnswerResponse>
    >,
    contextOptions?: AnswerContextOptions,
): Promise<Result<answerSchema.AnswerResponse>> {
    const context = answerContextFromSearchResult(
        conversation,
        searchResult,
        contextOptions,
    );
    const contextContent = answerContextToString(context);
    const chunking = contextOptions?.chunking ?? true;
    if (
        contextContent.length <= generator.settings.maxCharsInBudget ||
        !chunking
    ) {
        // Context is small enough
        return generator.generateAnswer(question, contextContent);
    }
    //
    // Use chunks
    //
    const chunks = splitContextIntoChunks(
        context,
        generator.settings.maxCharsInBudget,
    );
    const chunkResponses = await generateAnswerInChunks(
        generator,
        question,
        chunks,
        progress,
    );
    if (!chunkResponses.success) {
        return chunkResponses;
    }
    // We have partial answers from each chunk... merge and rewrite them into a whole
    const answer = await generator.combinePartialAnswers(
        question,
        chunkResponses.data,
    );
    return answer;
}

/**
 * Generates answers in chunks for a given question based on provided context chunks.
 * Processes the chunks in parallel, and merges the answers from individual chunks.
 *
 * @param answerGenerator - answer generator to use
 * @param question - The question that was asked.
 * @param chunks - The context chunks to use for answer generation.
 * @param progress - Optional progress callback to track the progress of chunk processing.
 *
 * @returns A promise that resolves to a Result containing an array of AnswerResponses.
 */
export async function generateAnswerInChunks(
    answerGenerator: IAnswerGenerator,
    question: string,
    chunks: contextSchema.AnswerContext[],
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

    let chunkAnswers: answerSchema.AnswerResponse[] = [];
    const structuredChunks = getStructuredChunks(chunks);
    let hasStructuredAnswer = false;
    if (structuredChunks.length > 0) {
        const structuredAnswers = await runGenerateAnswers(
            answerGenerator,
            question,
            structuredChunks,
            progress,
        );
        if (!structuredAnswers.success) {
            return structuredAnswers;
        }
        chunkAnswers.push(...structuredAnswers.data);
        hasStructuredAnswer = hasAnswer(chunkAnswers);
    }

    if (!hasStructuredAnswer || !answerGenerator.settings.fastStop) {
        // Generate partial answers from each message chunk
        const messageChunks = chunks.filter(
            (c) => c.messages !== undefined && c.messages.length > 0,
        );
        const messageAnswers = await runGenerateAnswers(
            answerGenerator,
            question,
            messageChunks,
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

    function getStructuredChunks(
        chunks: contextSchema.AnswerContext[],
    ): contextSchema.AnswerContext[] {
        const structuredChunks: contextSchema.AnswerContext[] = [];
        for (const chunk of chunks) {
            let structuredChunk: contextSchema.AnswerContext | undefined =
                undefined;
            if (chunk.entities) {
                structuredChunk ??= {};
                structuredChunk.entities = chunk.entities;
            }
            if (chunk.topics) {
                structuredChunk ??= {};
                structuredChunk.topics = chunk.topics;
            }
            if (structuredChunk !== undefined) {
                structuredChunks.push(structuredChunk);
            }
        }
        return structuredChunks;
    }
}

/**
 * *Early Experimental*
 * Generate answer from a set of multiple answer choices.
 * @param conversation
 * @param generator answer generator to use
 * @param question question the user asked
 * @param answerChoices Answer should be one of these
 * @param searchResult searchResults to use for answering the question
 * @param progress
 * @param contextOptions
 */
export function generateMultipleChoiceAnswer(
    conversation: IConversation,
    generator: IAnswerGenerator,
    question: string,
    answerChoices: string[],
    searchResults: ConversationSearchResult | ConversationSearchResult[],
    progress?: asyncArray.ProcessProgress<
        contextSchema.AnswerContext,
        Result<answerSchema.AnswerResponse>
    >,
    contextOptions?: AnswerContextOptions,
) {
    question = createMultipleChoiceQuestion(question, answerChoices);
    return generateAnswer(
        conversation,
        generator,
        question,
        searchResults,
        progress,
        contextOptions,
    );
}

/**
 * Default Answer Generator. Implements {@link IAnswerGenerator}
 */
export class AnswerGenerator implements IAnswerGenerator {
    public settings: AnswerGeneratorSettings;
    private answerTranslator: AnswerTranslator;
    private contextSchema: string;
    private contextTypeName: string;

    constructor(settings?: AnswerGeneratorSettings) {
        this.settings = settings ?? createAnswerGeneratorSettings();
        this.answerTranslator = createAnswerTranslator(
            this.settings.answerGeneratorModel,
        );
        this.contextSchema = loadSchema(
            ["dateTimeSchema.ts", "answerContextSchema.ts"],
            import.meta.url,
        ).trim();
        this.contextTypeName = "AnswerContext";
    }

    public generateAnswer(
        question: string,
        context: contextSchema.AnswerContext | string,
    ): Promise<Result<answerSchema.AnswerResponse>> {
        let contextContent =
            typeof context === "string"
                ? context
                : answerContextToString(context);
        if (contextContent.length > this.settings.maxCharsInBudget) {
            contextContent = trimStringLength(
                contextContent,
                this.settings.maxCharsInBudget,
            );
        }
        let prompt: string[] = [];
        const questionPrompt = createQuestionPrompt(question);
        prompt.push(questionPrompt);
        prompt.push(
            createContextPrompt(
                this.contextTypeName,
                this.settings.includeContextSchema !== undefined &&
                    this.settings.includeContextSchema
                    ? this.contextSchema
                    : "",
                contextContent,
            ),
        );
        const promptText = prompt.join("\n\n");
        return this.answerTranslator.translate(
            promptText,
            this.settings.modelInstructions,
        );
    }

    public async combinePartialAnswers(
        question: string,
        partialAnswers: (answerSchema.AnswerResponse | undefined)[],
    ): Promise<Result<answerSchema.AnswerResponse>> {
        if (partialAnswers.length === 1) {
            let response = partialAnswers[0];
            if (response) {
                return success(response);
            }
            return error("No answer");
        }
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
                    this.settings.maxCharsInBudget,
                );
                const rewrittenAnswer = await rewriteText(
                    this.settings.answerCombinerModel,
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
        answerGeneratorModel:
            model ?? openai.createJsonChatModel(undefined, ["answerGenerator"]),
        answerCombinerModel: openai.createChatModel(),
        maxCharsInBudget: 4096 * 4, // 4096 tokens * 4 chars per token,
        concurrency: 2,
        fastStop: true,
    };
}

export function answerContextFromSearchResult(
    conversation: IConversation,
    searchResult: ConversationSearchResult,
    options?: AnswerContextOptions,
): contextSchema.AnswerContext {
    let context: contextSchema.AnswerContext = {};
    for (const knowledgeType of searchResult.knowledgeMatches.keys()) {
        switch (knowledgeType) {
            default:
                break;
            case "entity":
                context.entities = getRelevantEntitiesForAnswer(
                    conversation,
                    searchResult.knowledgeMatches.get(knowledgeType)!,
                    options?.entitiesTopK,
                );
                break;
            case "topic":
                context.topics = getRelevantTopicsForAnswer(
                    conversation,
                    searchResult.knowledgeMatches.get(knowledgeType)!,
                    options?.topicsTopK,
                );
                break;
        }
    }
    if (searchResult.messageMatches && searchResult.messageMatches.length > 0) {
        context.messages = getRelevantMessagesForAnswer(
            conversation,
            searchResult.messageMatches,
            options?.messagesTopK,
        );
    }
    return context;
}

export function getRelevantTopicsForAnswer(
    conversation: IConversation,
    searchResult: SemanticRefSearchResult,
    topK?: number,
): contextSchema.RelevantKnowledge[] {
    const scoredEntities = getScoredSemanticRefsFromOrdinals(
        conversation.semanticRefs!,
        searchResult.semanticRefMatches,
        "topic",
    );
    let mergedTopics = mergeScoredTopics(scoredEntities, true);
    let candidateTopics: Iterable<Scored<MergedTopic>> = mergedTopics.values();
    if (topK !== undefined && topK > 0 && mergedTopics.size > topK) {
        candidateTopics = getTopK(candidateTopics, topK);
    }
    const relevantTopics: contextSchema.RelevantKnowledge[] = [];
    for (const scoredValue of candidateTopics) {
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
    topK?: number,
): contextSchema.RelevantKnowledge[] {
    const scoredEntities = getScoredSemanticRefsFromOrdinals(
        conversation.semanticRefs!,
        searchResult.semanticRefMatches,
        "entity",
    );
    const mergedEntities = mergeScoredConcreteEntities(scoredEntities, true);
    let candidateEntities: Iterable<Scored<MergedEntity>> =
        mergedEntities.values();
    if (topK !== undefined && topK > 0 && mergedEntities.size > topK) {
        candidateEntities = getTopK(candidateEntities, topK);
    }
    const relevantEntities: contextSchema.RelevantKnowledge[] = [];
    for (const scoredValue of candidateEntities) {
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
    topK?: number,
): contextSchema.RelevantMessage[] {
    const relevantMessages: contextSchema.RelevantMessage[] = [];
    for (const message of getMessagesFromScoredOrdinals(
        conversation.messages,
        messageOrdinals,
    )) {
        if (message.textChunks.length === 0) {
            continue;
        }
        const relevantMessage: contextSchema.RelevantMessage = {};
        const meta = message.metadata;
        if (meta) {
            relevantMessage.from = meta.source;
            relevantMessage.to = meta.dest;
        }
        if (message.timestamp) {
            relevantMessage.timestamp = new Date(message.timestamp);
        }
        relevantMessage.messageText =
            message.textChunks.length === 1
                ? message.textChunks[0]
                : message.textChunks;
        relevantMessages.push(relevantMessage);
        if (topK !== undefined && topK > 0 && relevantMessages.length >= topK) {
            break;
        }
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

async function runGenerateAnswers(
    answerGenerator: IAnswerGenerator,
    question: string,
    chunks: contextSchema.AnswerContext[],
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
        answerGenerator.settings.concurrency,
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
        "The following is a user question:",
        "===",
        question,
        "",
        "===",
        "- The included [ANSWER CONTEXT] contains information that MAY be relevant to answering the question.",
        "- Answer the user question PRECISELY using ONLY information EXPLICITLY provided in the topics, entities, actions, messages and time ranges/timestamps found in [ANSWER CONTEXT]",
        "- Return 'NoAnswer' if you are unsure, , if the answer is not explicitly in [ANSWER CONTEXT], or if the topics or {entity names, types and facets} in the question are not found in [ANSWER CONTEXT].",
        "- Use the 'name', 'type' and 'facets' properties of the provided JSON entities to identify those highly relevant to answering the question.",
        "- 'origin' and 'audience' fields contain the names of entities involved in communication about the knowledge",
        "**Important:** Communicating DOES NOT imply associations such as authorship, ownership etc. E.g. origin: [X] telling audience [Y, Z] communicating about a book does not imply authorship.",
        "- When asked for lists, ensure the list contents answer the question and nothing else. E.g. for the question 'List all books': List only the books in [ANSWER CONTEXT].",
        "- Use direct quotes only when needed or asked. Otherwise answer in your own words.",
        "- Your answer is readable and complete, with appropriate formatting: line breaks, numbered lists, bullet points etc.",
    ];
    return prompt.join("\n");
}

function createContextPrompt(
    typeName: string,
    schema: string,
    context: string,
): string {
    let content =
        schema && schema.length > 0
            ? `[ANSWER CONTEXT] for answering user questions is a JSON object of type ${typeName} according to the following TypeScript definitions:\n` +
              `\`\`\`\n${schema}\`\`\`\n`
            : "";
    content += `[ANSWER CONTEXT]\n` + `===\n${context}\n===\n`;
    return content;
}
