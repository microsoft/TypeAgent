import * as kp from "knowpro";
import * as knowLib from "knowledge-processor";
import { CommandHandler, InteractiveIo } from "interactive-app";
import { ensureDir } from "typeagent";

import { ChatModel, TextEmbeddingModel, openai } from "aiclient";
import { SRAG_MEM_DIR } from "../common.js";

export type Models = {
    chatModel: ChatModel;
    answerModel: ChatModel;
    embeddingModel: TextEmbeddingModel;
    embeddingModelSmall?: TextEmbeddingModel | undefined;
};

export type ChatContext = {
    io: InteractiveIo;
    storePath: string;
    statsPath: string;
    models: Models;
    maxCharsPerChunk: number;
    stats?: knowLib.IndexingStats | undefined;
    topicWindowSize: number;
    searchConcurrency: number;
    minScore: number;
    entityTopK: number;
    actionTopK: number;
    conversationName: string;
    conversationSettings: knowLib.conversation.ConversationSettings;
};

export function createModels(): Models {
    const chatModelSettings = openai.apiSettingsFromEnv(openai.ModelType.Chat);
    chatModelSettings.retryPauseMs = 10000;
    const embeddingModelSettings = openai.apiSettingsFromEnv(
        openai.ModelType.Embedding,
    );
    embeddingModelSettings.retryPauseMs = 25 * 1000;

    const models: Models = {
        chatModel: openai.createJsonChatModel(chatModelSettings, [
            "doc-memory",
        ]),
        answerModel: openai.createChatModel(),
        embeddingModel: knowLib.createEmbeddingCache(
            openai.createEmbeddingModel(embeddingModelSettings),
            1024,
        ),
        /*
        embeddingModelSmall: knowLib.createEmbeddingCache(
            openai.createEmbeddingModel("3_SMALL", 1536),
            256,
        ),
        */
    };
    models.chatModel.completionSettings.seed = 123;
    models.answerModel.completionSettings.seed = 123;
    return models;
}

export type KnowProContext = {
    knowledgeModel: ChatModel;
    knowledgeActions: knowLib.conversation.KnowledgeActionTranslator;
    basePath: string;
    queryTranslator: kp.SearchQueryTranslator;
    answerGenerator: kp.AnswerGenerator;
};

export async function createKnowproCommands(
    chatContext: ChatContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const knowledgeModel = chatContext.models.chatModel;
    const context: KnowProContext = {
        knowledgeModel,
        knowledgeActions:
            knowLib.conversation.createKnowledgeActionTranslator(
                knowledgeModel,
            ),
        queryTranslator: kp.createSearchQueryTranslator(knowledgeModel),
        answerGenerator: new kp.AnswerGenerator(
            kp.createAnswerGeneratorSettings(knowledgeModel),
        ),
        basePath: `${SRAG_MEM_DIR}`,
    };

    await ensureDir(context.basePath);
}
