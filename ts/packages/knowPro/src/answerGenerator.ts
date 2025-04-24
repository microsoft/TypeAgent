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
    MessageOrdinal,
    SemanticRefSearchResult,
} from "./interfaces.js";
import {
    mergedToConcreteEntity,
    mergeScoredConcreteEntities,
    mergeScoredTopics,
} from "./knowledgeMerge.js";
import { getScoredSemanticRefsFromOrdinals } from "./knowledgeLib.js";
import { getEnclosingDateRangeForMessages } from "./message.js";
import { AnswerContext, RelevantKnowledge } from "./answerContextSchema.js";
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
    result: ConversationSearchResult,
) {
    let context: AnswerContext = {};
    for (const knowledgeType of result.knowledgeMatches.keys()) {
        switch (knowledgeType) {
            default:
                break;
            case "entity":
                context.entities = getRelevantEntitiesForAnswer(
                    conversation,
                    result.knowledgeMatches.get(knowledgeType)!,
                );
                break;
            case "topic":
                context.topics = getRelevantTopicsForAnswer(
                    conversation,
                    result.knowledgeMatches.get(knowledgeType)!,
                );
                break;
        }
    }
    return context;
}

export function getRelevantTopicsForAnswer(
    conversation: IConversation,
    searchResult: SemanticRefSearchResult,
    callback?: (
        relevantKnowledge: RelevantKnowledge,
        sourceMessageOrdinals?: Set<MessageOrdinal> | undefined,
    ) => void,
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
            callback,
        );
        relevantTopics.push(relevantTopic);
    }
    return relevantTopics;
}

export function getRelevantEntitiesForAnswer(
    conversation: IConversation,
    searchResult: SemanticRefSearchResult,
    callback?: (
        relevantKnowledge: RelevantKnowledge,
        sourceMessageOrdinals?: Set<MessageOrdinal> | undefined,
    ) => void,
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
            callback,
        );
        relevantEntities.push(relevantEntity);
    }
    return relevantEntities;
}

function createRelevantKnowledge(
    conversation: IConversation,
    knowledge: any,
    sourceMessageOrdinals?: Set<MessageOrdinal>,
    callback?: (
        relevantKnowledge: RelevantKnowledge,
        sourceMessageOrdinals?: Set<MessageOrdinal>,
    ) => void,
): RelevantKnowledge {
    const relevantKnowledge: RelevantKnowledge = {
        knowledge,
        timeRange: sourceMessageOrdinals
            ? getEnclosingDateRangeForMessages(
                  conversation.messages,
                  sourceMessageOrdinals,
              )
            : undefined,
    };
    if (callback) {
        callback(relevantKnowledge, sourceMessageOrdinals);
    }
    return relevantKnowledge;
}

function createQuestionPrompt(question: string): string {
    let prompt: string[] = [
        `The following is a user question about a conversation:\n===\n${question}\n===\n`, // Leave the '/n' here
        "The included [ANSWER CONTEXT] contains information that MAY be relevant to answering the question.",
        "Answer the question using only relevant topics, entities, actions, messages and time ranges/timestamps found in [ANSWER CONTEXT].",
        "Use the name and type of the provided entities to select those highly relevant to answering the question.",
        "Don't answer if the topics and entity names/types in the question are not in the conversation history.",
        "List ALL entities if query intent implies that.",
        "Your answer is readable and complete, with suitable formatting (line breaks, bullet points etc).",
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
    if (context.entities) {
        json += add("entities", context.entities);
    }
    if (context.topics) {
        json += add("topics", context.topics);
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
