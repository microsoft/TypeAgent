// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "@typeagent/aiclient";

export function createWikiModels(endpoint?: string) {
    const extractionProvider = openai.getChatModelSettings(
        openai.GPT_6_LUNA,
    ).provider;
    const viewProvider = openai.getChatModelSettings(endpoint).provider;
    if (
        !["azure", "openai"].includes(extractionProvider) ||
        !["azure", "openai"].includes(viewProvider)
    )
        throw new Error(
            "Serialized wiki request budgeting requires an Azure/OpenAI REST transport",
        );
    const extractionModel = openai.createChatModel(
        openai.GPT_6_LUNA,
        {
            response_format: { type: "json_object" },
        },
        undefined,
        ["durable-index"],
    );
    return {
        extractionModel,
        languageModel: openai.createChatModel(endpoint),
        provider: viewProvider,
    };
}
