// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Wire-protocol adapter dispatch.
 *
 * The routing pool (`endpointPool.ts` / `restClient.ts`) picks *which*
 * endpoint to call. `adapterFor(wireApi)` then selects the encoder/decoder
 * for that endpoint's wire shape.
 *
 * Default is always `chat_completions` — omitting `wireApi` (legacy configs)
 * is byte-identical to the pre-adapter path.
 */

import {
    DEFAULT_WIRE_API,
    type WireApi,
} from "@typeagent/config";
import type { ProviderAdapter } from "./types.js";
import { chatCompletionsAdapter } from "./chatCompletions.js";
import { anthropicMessagesAdapter } from "./anthropicMessages.js";
import { openaiResponsesAdapter } from "./openaiResponses.js";

/** Default wire protocol when `wireApi` is omitted. */
export const DEFAULT_PROVIDER_ADAPTER: ProviderAdapter = chatCompletionsAdapter;

// Keep the config default and the runtime default aligned.
// DEFAULT_WIRE_API is chat_completions (see @typeagent/config).

/**
 * Select the wire adapter for a wireApi value. Called after the pool has
 * chosen an endpoint.
 *
 * - `undefined` / omitted → `chat_completions` (default)
 * - `chat_completions` → OpenAI/Azure `/chat/completions`
 * - `openai_responses` → OpenAI `/responses`
 * - `anthropic_messages` → Anthropic `/v1/messages`
 */
export function adapterFor(wireApi: WireApi | undefined): ProviderAdapter {
    switch (wireApi ?? DEFAULT_WIRE_API) {
        case "chat_completions":
            return chatCompletionsAdapter;
        case "openai_responses":
            return openaiResponsesAdapter;
        case "anthropic_messages":
            return anthropicMessagesAdapter;
        default: {
            // Exhaustiveness guard: a new WireApi must add a case above.
            // Unknown values fall back to the default chat_completions path.
            const _exhaustive: never = wireApi as never;
            void _exhaustive;
            return DEFAULT_PROVIDER_ADAPTER;
        }
    }
}
