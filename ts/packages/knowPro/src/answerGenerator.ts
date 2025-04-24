// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel, openai } from "aiclient";
import { conversation as kpLib } from "knowledge-processor";
import { ConversationSearchResult } from "./search.js";
import {
    createJsonTranslator,
    Result,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import * as answerSchema from "./answerSchema.js";
import { loadSchema } from "typeagent";
import { createTypeScriptJsonValidator } from "typechat/ts";
import {
    DateRange,
    IConversation,
    Knowledge,
    SemanticRefSearchResult,
} from "./interfaces.js";
import {
    mergedToConcreteEntity,
    mergeScoredConcreteEntities,
} from "./knowledgeMerge.js";
import { getScoredSemanticRefsFromOrdinals } from "./knowledgeLib.js";
import { getEnclosingDateRangeForMessages } from "./message.js";

export type AnswerTranslator =
    TypeChatJsonTranslator<answerSchema.AnswerResponse>;

export function createAnswerTranslator(
    model: TypeChatLanguageModel,
): AnswerTranslator {
    const typeName = "AnswerResponse";
    const searchActionSchema = loadSchema(
        ["answerGenerator.ts"],
        import.meta.url,
    );

    return createJsonTranslator<answerSchema.AnswerResponse>(
        model,
        createTypeScriptJsonValidator<answerSchema.AnswerResponse>(
            searchActionSchema,
            typeName,
        ),
    );
}

export interface IAnswerGenerator {
    generateAnswer(
        question: string,
        searchResults: ConversationSearchResult,
    ): Promise<Result<answerSchema.AnswerResponse>>;
}

export type AnswerGeneratorSettings = {
    languageModel: ChatModel;
};

export class AnswerGenerator implements IAnswerGenerator {
    public settings: AnswerGeneratorSettings;
    private answerTranslator: AnswerTranslator;

    constructor(settings?: AnswerGeneratorSettings) {
        settings ??= createAnswerGeneratorSettings();
        this.settings = settings;
        this.answerTranslator = createAnswerTranslator(
            this.settings.languageModel,
        );
    }

    public generateAnswer(
        question: string,
        searchResults: ConversationSearchResult,
    ): Promise<Result<kpLib.AnswerResponse>> {
        //const prompt = kpLib.createAnswerGenerationPrompt(question, true);
        return this.answerTranslator.translate(question);
    }
}

export function createAnswerGeneratorSettings(): AnswerGeneratorSettings {
    return {
        languageModel: openai.createChatModelDefault("answerGenerator"),
    };
}

export type AnswerContext = {};

export type AnswerContextItem = {
    knowledge: Knowledge;
    timeRange?: DateRange | undefined;
};

export function getDistinctEntities(
    conversation: IConversation,
    searchResult: SemanticRefSearchResult,
    topK: number,
) {
    const scoredEntities = getScoredSemanticRefsFromOrdinals(
        conversation.semanticRefs!,
        searchResult.semanticRefMatches,
        "entity",
    );
    const mergedEntities = mergeScoredConcreteEntities(scoredEntities, true);
    const contextItems: AnswerContextItem[] = [];
    for (const scoredValue of mergedEntities.values()) {
        let mergedEntity = scoredValue.item;
        const item: AnswerContextItem = {
            knowledge: mergedToConcreteEntity(mergedEntity),
            timeRange: mergedEntity.messageOrdinals
                ? getEnclosingDateRangeForMessages(
                      conversation.messages,
                      mergedEntity.messageOrdinals,
                  )
                : undefined,
        };
        contextItems.push(item);
    }
    return contextItems;
}
