// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
import { conversation as kpLib } from "knowledge-processor";
import {
    createJsonTranslator,
    Result,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import * as answerSchema from "./answerResponseSchema.js";
import { loadSchema } from "typeagent";
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
import {
    AnswerContext,
    RelevantKnowledge,
    RelevantMessage,
} from "./answerContextSchema.js";
import { ConversationSearchResult } from "./search.js";

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
    generateAnswer(
        question: string,
        context: AnswerContext,
    ): Promise<Result<answerSchema.AnswerResponse>>;
}

export type AnswerGeneratorSettings = {
    languageModel: ChatModel;
};

export class AnswerGenerator implements IAnswerGenerator {
    public settings: AnswerGeneratorSettings;
    private answerTranslator: AnswerTranslator;
    private contextSchema: string;
    private contextTypeName: string;

    constructor(settings?: AnswerGeneratorSettings) {
        settings ??= createAnswerGeneratorSettings();
        this.settings = settings;
        this.answerTranslator = createAnswerTranslator(
            this.settings.languageModel,
        );
        this.contextSchema = loadSchema(
            ["dateTimeSchema.ts", "answerContextSchema.ts"],
            import.meta.url,
        );
        this.contextTypeName = "AnswerContext";
    }

    public generateAnswer(
        question: string,
        context: AnswerContext,
    ): Promise<Result<kpLib.AnswerResponse>> {
        const contextContent = answerContextToString(context);
        const contextPrompt = createContextPrompt(
            this.contextTypeName,
            this.contextSchema,
            contextContent,
        );
        const questionPrompt = createQuestionPrompt(question);
        return this.answerTranslator.translate(questionPrompt, contextPrompt);
    }
}

export function createAnswerGeneratorSettings(): AnswerGeneratorSettings {
    return {
        languageModel: openai.createChatModelDefault("answerGenerator"),
    };
}

export function answerContextFromSearchResult(
    conversation: IConversation,
    searchResult: ConversationSearchResult,
) {
    let context: AnswerContext = {};
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
): RelevantKnowledge[] {
    const scoredEntities = getScoredSemanticRefsFromOrdinals(
        conversation.semanticRefs!,
        searchResult.semanticRefMatches,
        "topic",
    );
    const mergedTopics = mergeScoredTopics(scoredEntities, true);
    const relevantTopics: RelevantKnowledge[] = [];
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
): RelevantKnowledge[] {
    const scoredEntities = getScoredSemanticRefsFromOrdinals(
        conversation.semanticRefs!,
        searchResult.semanticRefMatches,
        "entity",
    );
    const mergedEntities = mergeScoredConcreteEntities(scoredEntities, true);
    const relevantEntities: RelevantKnowledge[] = [];
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
): RelevantMessage[] {
    const relevantMessages: RelevantMessage[] = [];
    for (const message of getMessagesFromScoredOrdinals(
        conversation.messages,
        messageOrdinals,
    )) {
        const relevantMessage: RelevantMessage = {
            message: message.textChunks.join("\n"),
        };
        const meta = message.metadata;
        if (meta) {
            relevantMessage.from = meta.source;
            relevantMessage.to = meta.dest;
        }
        relevantMessages.push(relevantMessage);
    }
    return relevantMessages;
}

function createRelevantKnowledge(
    conversation: IConversation,
    knowledge: Knowledge,
    sourceMessageOrdinals?: Iterable<MessageOrdinal>,
): RelevantKnowledge {
    let relevantKnowledge: RelevantKnowledge = {
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
): string {
    let prompt =
        `Context relevant for answering the question is a JSON objects of type ${typeName} according to the following TypeScript definitions :\n` +
        `\`\`\`\n${schema}\`\`\`\n` +
        `[ANSWER CONTEXT]\n` +
        `"""\n${context}\n"""\n`;

    return prompt;
}

function answerContextToString(context: AnswerContext): string {
    let json = "{\n";
    let propertyCount = 0;
    if (context.entities && context.entities.length > 0) {
        json += add("entities", context.entities);
    }
    if (context.topics && context.topics.length > 0) {
        json += add("topics", context.topics);
    }
    if (context.messages && context.messages.length > 0) {
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
