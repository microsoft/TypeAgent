// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// aiclient ChatModel factories for each onboarding phase.
// Each phase gets a distinct debug tag so LLM calls are easy to trace
// with DEBUG=typeagent:openai:* environment variable.
//
// Credentials are read from ts/.env via the standard TypeAgent mechanism.

import { ChatModel, openai } from "aiclient";

export function getDiscoveryModel(): ChatModel {
    return openai.createChatModelDefault("onboarding:discovery");
}

export function getPhraseGenModel(): ChatModel {
    return openai.createChatModelDefault("onboarding:phrasegen");
}

export function getSchemaGenModel(): ChatModel {
    return openai.createChatModelDefault("onboarding:schemagen");
}

export function getGrammarGenModel(): ChatModel {
    return openai.createChatModelDefault("onboarding:grammargen");
}

export function getTestingModel(): ChatModel {
    return openai.createChatModelDefault("onboarding:testing");
}

export function getPackagingModel(): ChatModel {
    return openai.createChatModelDefault("onboarding:packaging");
}
