// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// aiclient ChatModel factories for each onboarding phase.
// Each phase gets a distinct debug tag so LLM calls are easy to trace
// with DEBUG=typeagent:openai:* environment variable.
//
// Credentials are read from ts/.env via the standard TypeAgent mechanism.
// Pass an optional endpoint (e.g. "openai:gpt-5") to override the default
// model. When omitted the model is determined by the OPENAI_MODEL /
// AZURE_OPENAI_CHAT_MODEL_DEPLOYMENT_NAME environment variable.

import { ChatModel, openai } from "aiclient";

export function getDiscoveryModel(endpoint?: string): ChatModel {
    return openai.createChatModel(endpoint, undefined, undefined, [
        "onboarding:discovery",
    ]);
}

export function getPhraseGenModel(endpoint?: string): ChatModel {
    return openai.createChatModel(endpoint, undefined, undefined, [
        "onboarding:phrasegen",
    ]);
}

export function getSchemaGenModel(endpoint?: string): ChatModel {
    return openai.createChatModel(endpoint, undefined, undefined, [
        "onboarding:schemagen",
    ]);
}

export function getGrammarGenModel(endpoint?: string): ChatModel {
    return openai.createChatModel(endpoint, undefined, undefined, [
        "onboarding:grammargen",
    ]);
}

export function getTestingModel(endpoint?: string): ChatModel {
    return openai.createChatModel(endpoint, undefined, undefined, [
        "onboarding:testing",
    ]);
}

export function getPackagingModel(endpoint?: string): ChatModel {
    return openai.createChatModel(endpoint, undefined, undefined, [
        "onboarding:packaging",
    ]);
}

export function getExploreModel(endpoint?: string): ChatModel {
    // Default to GPT-5 — exploration benefits from reasoning when picking
    // the next frontier action and recognizing modal vs. neutral states.
    return openai.createChatModel(endpoint ?? "GPT_5", undefined, undefined, [
        "onboarding:explore",
    ]);
}

export function getSynthesisModel(endpoint?: string): ChatModel {
    // Synthesis (neutral classification, chunk clustering, per-cluster
    // action emission, validation) is structural reasoning over a large
    // graph — a reasoning model produces dramatically better aggregation.
    return openai.createChatModel(endpoint ?? "GPT_5", undefined, undefined, [
        "onboarding:synthesis",
    ]);
}
