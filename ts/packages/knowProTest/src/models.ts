// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { ChatModel, hasEnvSettings, inferenceClient } from "@typeagent/aiclient";

export interface LanguageModel {
    model: ChatModel;
    modelName: string;
}

export function hasApiSettings(key: string, endpoint?: string | undefined) {
    return hasEnvSettings(process.env, key, endpoint);
}

export function createKnowledgeModel(nameSuffix?: string) {
    const chatModelSettings = nameSuffix
        ? inferenceClient.apiSettingsFromEnv(
              inferenceClient.ModelType.Chat,
              undefined,
              nameSuffix,
          )
        : inferenceClient.apiSettingsFromEnv(inferenceClient.ModelType.Chat);
    chatModelSettings.retryPauseMs = 10000;
    const model = inferenceClient.createJsonChatModel(chatModelSettings, [
        "knowproTest",
    ]);
    // Use 0 temperature and explicit seed to minimize variation
    model.completionSettings.temperature = 0;
    model.completionSettings.seed = 345;
    //model.completionSettings.top_p = 0.2;

    return model;
}

export function createGpt41Models(): {
    gpt41: LanguageModel | undefined;
    gpt41Mini: LanguageModel | undefined;
} {
    let gpt41: LanguageModel | undefined;
    let gpt41Mini: LanguageModel | undefined;

    let modelName = "GPT_4_1";
    if (hasApiSettings(inferenceClient.EnvVars.AZURE_OPENAI_API_KEY, modelName)) {
        gpt41 = { model: createKnowledgeModel(modelName), modelName };
    }
    modelName = "GPT_4_1_MINI";
    if (hasApiSettings(inferenceClient.EnvVars.AZURE_OPENAI_API_KEY, modelName)) {
        gpt41Mini = { model: createKnowledgeModel(modelName), modelName };
    }

    return {
        gpt41,
        gpt41Mini,
    };
}

export function create35Model(): LanguageModel | undefined {
    const modelName = "GPT_35_TURBO";
    if (hasApiSettings(inferenceClient.EnvVars.AZURE_OPENAI_API_KEY, modelName)) {
        return { model: createKnowledgeModel(modelName), modelName };
    }
    return undefined;
}
