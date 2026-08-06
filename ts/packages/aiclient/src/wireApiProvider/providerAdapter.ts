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

import { DEFAULT_WIRE_API, type WireApi } from "@typeagent/config";
import type { ProviderAdapter } from "./types.js";
import { chatCompletionsWireApiProvider } from "./chatCompletionsWireApiProvider.js";
import { messagesWireApiProvider } from "./messagesWireApiProvider.js";
import { responsesWireApiProvider } from "./responsesWireApiProvider.js";

export const DEFAULT_WIRE_API_PROVIDER: ProviderAdapter =
    chatCompletionsWireApiProvider;

export function adapterFor(wireApi: WireApi | undefined): ProviderAdapter {
    switch (wireApi ?? DEFAULT_WIRE_API) {
        case "chat_completions":
            return chatCompletionsWireApiProvider;
        case "responses":
            return responsesWireApiProvider;
        case "messages":
            return messagesWireApiProvider;
        default: {
            const _exhaustive: never = wireApi as never;
            void _exhaustive;
            return DEFAULT_WIRE_API_PROVIDER;
        }
    }
}
