// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// aiclient ChatModel factories for each onboarding phase.
// Each phase gets a distinct debug tag so LLM calls are easy to trace
// with DEBUG=typeagent:openai:* environment variable.
//
// Credentials are read from ts/.env via the standard TypeAgent mechanism.

import { createChatModelDefault } from "aiclient";
import type { ChatModel } from "aiclient";

export function getDiscoveryModel(): ChatModel {
    return createChatModelDefault("onboarding:discovery");
}

export function getPhraseGenModel(): ChatModel {
    return createChatModelDefault("onboarding:phrasegen");
}

export function getSchemaGenModel(): ChatModel {
    return createChatModelDefault("onboarding:schemagen");
}

export function getGrammarGenModel(): ChatModel {
    return createChatModelDefault("onboarding:grammargen");
}

export function getTestingModel(): ChatModel {
    return createChatModelDefault("onboarding:testing");
}

export function getPackagingModel(): ChatModel {
    return createChatModelDefault("onboarding:packaging");
}
