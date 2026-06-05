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
import { AsyncLocalStorage } from "node:async_hooks";

// ---------------------------------------------------------------------------
// LLM token-usage accounting
//
// Every ChatModel the onboarding agent uses is created by one of the factory
// functions below. Rather than thread a token accumulator through the many
// handlers/translators, we keep the active accumulator in an AsyncLocalStorage.
// executeAction establishes the context via runWithTokenUsage(); each model
// created here then reports its usage into whatever accumulator is active when
// the completion resolves. The accumulator is surfaced on the ActionResult so
// the dispatcher can report "Action Tokens".
// ---------------------------------------------------------------------------

// Structurally compatible with agent-sdk's ActionTokenUsage and aiclient's
// CompletionUsageStats.
export type OnboardingTokenUsage = {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
};

const tokenUsageStore = new AsyncLocalStorage<OnboardingTokenUsage>();

// Run `fn` with `usage` as the active token accumulator. LLM calls issued by
// models from the factories below (anywhere in the awaited call tree) fold
// their usage into `usage`.
export function runWithTokenUsage<T>(
    usage: OnboardingTokenUsage,
    fn: () => Promise<T>,
): Promise<T> {
    return tokenUsageStore.run(usage, fn);
}

// Attach a completionCallback that folds reported usage into the active
// accumulator. Composes with any existing callback rather than overwriting it.
// The accumulator is read when the completion resolves, so models used outside
// an active context (e.g. tests, CLI smoke scripts) simply report nowhere.
function instrumentModel<T extends ChatModel>(model: T): T {
    const previous = model.completionCallback;
    model.completionCallback = (request, response) => {
        previous?.(request, response);
        const usage = (response as any)?.usage;
        const accumulator = tokenUsageStore.getStore();
        if (usage && accumulator) {
            accumulator.prompt_tokens += usage.prompt_tokens ?? 0;
            accumulator.completion_tokens += usage.completion_tokens ?? 0;
            accumulator.total_tokens += usage.total_tokens ?? 0;
        }
    };
    return model;
}

export function getDiscoveryModel(endpoint?: string): ChatModel {
    return instrumentModel(
        openai.createChatModel(endpoint, undefined, undefined, [
            "onboarding:discovery",
        ]),
    );
}

export function getPhraseGenModel(endpoint?: string): ChatModel {
    return instrumentModel(
        openai.createChatModel(endpoint, undefined, undefined, [
            "onboarding:phrasegen",
        ]),
    );
}

export function getSchemaGenModel(endpoint?: string): ChatModel {
    return instrumentModel(
        openai.createChatModel(endpoint, undefined, undefined, [
            "onboarding:schemagen",
        ]),
    );
}

export function getGrammarGenModel(endpoint?: string): ChatModel {
    return instrumentModel(
        openai.createChatModel(endpoint, undefined, undefined, [
            "onboarding:grammargen",
        ]),
    );
}

export function getTestingModel(endpoint?: string): ChatModel {
    return instrumentModel(
        openai.createChatModel(endpoint, undefined, undefined, [
            "onboarding:testing",
        ]),
    );
}

export function getPackagingModel(endpoint?: string): ChatModel {
    return instrumentModel(
        openai.createChatModel(endpoint, undefined, undefined, [
            "onboarding:packaging",
        ]),
    );
}

export function getExploreModel(endpoint?: string): ChatModel {
    // Default to GPT-5 — exploration benefits from reasoning when picking
    // the next frontier action and recognizing modal vs. neutral states.
    return instrumentModel(
        openai.createChatModel(endpoint ?? "GPT_5", undefined, undefined, [
            "onboarding:explore",
        ]),
    );
}

export function getSynthesisModel(endpoint?: string): ChatModel {
    // Synthesis (neutral classification, chunk clustering, per-cluster
    // action emission, validation) is structural reasoning over a large
    // graph — a reasoning model produces dramatically better aggregation.
    return instrumentModel(
        openai.createChatModel(endpoint ?? "GPT_5", undefined, undefined, [
            "onboarding:synthesis",
        ]),
    );
}

export function getReconModel(endpoint?: string): ChatModel {
    // Reconnaissance is vision-driven (sends screenshots) so we must use a
    // multimodal-capable deployment. GPT-v is the dedicated vision endpoint
    // in this Azure config. (GPT-5 deployments here returned "API version
    // not supported" for image_url content; GPT-4o uses a /v1/ URL shape
    // that aiclient doesn't construct correctly.)
    return instrumentModel(
        openai.createChatModel(endpoint ?? "GPT_v", undefined, undefined, [
            "onboarding:recon",
        ]),
    );
}
