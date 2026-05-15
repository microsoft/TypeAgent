// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Lazy aiclient access: this module is only imported when --llm is set
// on the CLI, so packages that just want the deterministic skeleton
// don't need aiclient built or AZURE_OPENAI env vars present.

import type { ChatModel } from "aiclient";
import { openai } from "aiclient";

/**
 * Model factory for Overview generation. Mirrors the
 * onboarding/lib/llm.ts pattern — a thin wrapper around aiclient that
 * tags requests so they can be traced via DEBUG=typeagent:openai:*.
 *
 * Defaults to the standard TypeChat env (AZURE_OPENAI_ENDPOINT etc.).
 * Pass an explicit endpoint string (e.g. "GPT_5") to use a suffixed
 * env block from ts/.env.
 */
export function getOverviewModel(endpoint?: string): ChatModel {
    return openai.createChatModel(endpoint, undefined, undefined, [
        "docs-autogen:overview",
    ]);
}
