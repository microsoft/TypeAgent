// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Wire-protocol providers package surface.
 *
 * Layout:
 *   providers/
 *     types.ts              — ProviderAdapter interface + shared request types
 *     shared.ts             — auth headers, content filters, usage helpers
 *     chatCompletions.ts    — default `/chat/completions` adapter
 *     openaiResponses.ts    — OpenAI `/responses` adapter
 *     anthropicMessages.ts  — Anthropic `/v1/messages` adapter
 *     providerAdapter.ts    — adapterFor() dispatch (default: chat_completions)
 *     index.ts              — this barrel
 */

export type {
    ModelRequest,
    StreamPiece,
    StreamDecoder,
    ProviderAdapter,
    Filter,
    FilterError,
    FilterResult,
} from "./types.js";

export {
    createApiHeaders,
    verifyFilterResults,
    usageFromInputOutput,
    splitSystemMessages,
} from "./shared.js";

export {
    ChatCompletionsAdapter,
    chatCompletionsAdapter,
} from "./chatCompletions.js";
export {
    OpenAIResponsesAdapter,
    openaiResponsesAdapter,
} from "./openaiResponses.js";
export {
    AnthropicMessagesAdapter,
    anthropicMessagesAdapter,
} from "./anthropicMessages.js";

export {
    adapterFor,
    DEFAULT_PROVIDER_ADAPTER,
} from "./providerAdapter.js";
