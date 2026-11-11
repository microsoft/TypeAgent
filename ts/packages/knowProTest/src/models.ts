// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { ChatModel, hasEnvSettings, openai } from "@typeagent/aiclient";

export interface LanguageModel {
    model: ChatModel;
    modelName: string;
}

export function hasApiSettings(key: string, endpoint?: string | undefined) {
    return hasEnvSettings(process.env, key, endpoint);
}

export function createKnowledgeModel(nameSuffix?: string) {
    const chatModelSettings = nameSuffix
        ? openai.apiSettingsFromEnv(
              openai.ModelType.Chat,
              undefined,
              nameSuffix,
          )
        : openai.apiSettingsFromEnv(openai.ModelType.Chat);
    chatModelSettings.retryPauseMs = 10000;
    return openai.createJsonChatModel(chatModelSettings, ["knowproTest"], {
        temperature: 0,
        seed: 345,
    });
}

export function createLunaModel(): LanguageModel {
    const modelName = openai.GPT_6_LUNA;
    return { model: createKnowledgeModel(modelName), modelName };
}
