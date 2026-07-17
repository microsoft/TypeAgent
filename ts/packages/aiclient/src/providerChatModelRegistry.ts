// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModelWithStreaming, CompletionSettings } from "./models.js";
import type { ApiSettings, ModelProviders } from "./openai.js";

// Provider chat-model factories are registered here so that openai.ts can
// dispatch to a provider (e.g. copilot) without importing the provider
// module directly. This dependency inversion keeps openai.ts free of edges
// to the provider modules that import it back.
export type ProviderChatModelFactory = (
    settings: ApiSettings,
    completionSettings?: CompletionSettings,
    completionCallback?: (request: unknown, response: unknown) => void,
    tags?: string[],
) => ChatModelWithStreaming;

const registry = new Map<ModelProviders, ProviderChatModelFactory>();

export function registerProviderChatModel(
    provider: ModelProviders,
    factory: ProviderChatModelFactory,
): void {
    registry.set(provider, factory);
}

export function getProviderChatModel(
    provider: ModelProviders,
): ProviderChatModelFactory | undefined {
    return registry.get(provider);
}
