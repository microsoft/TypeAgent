// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { ChatModel, openai } from "@typeagent/aiclient";

export interface LanguageModel {
    model: ChatModel;
    modelName: string;
}

export function createKnowledgeModel(nameSuffix = openai.GPT_6_LUNA) {
    const chatModelSettings = openai.apiSettingsFromEnv(
        openai.ModelType.Chat,
        undefined,
        nameSuffix,
    );
    chatModelSettings.retryPauseMs = 10000;
    const model = openai.createJsonChatModel(chatModelSettings, [
        "knowproTest",
    ]);
    // Use 0 temperature and explicit seed to minimize variation
    model.completionSettings.temperature = 0;
    model.completionSettings.seed = 345;
    //model.completionSettings.top_p = 0.2;

    return model;
}
