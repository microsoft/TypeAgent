// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Lazy aiclient access: this module is only imported when --llm is set
// on the CLI, so packages that just want the deterministic skeleton
// don't need aiclient built or AZURE_OPENAI env vars present.

import type { ChatModel } from "@typeagent/aiclient";
import { openai } from "@typeagent/aiclient";

/**
 * Model factory for documentation generation. Wraps aiclient with a
 * debug tag so requests can be traced via DEBUG=typeagent:openai:*.
 *
 * Defaults to the standard TypeChat env (AZURE_OPENAI_ENDPOINT etc.).
 * Pass an explicit endpoint string (e.g. "GPT_5") to use a suffixed
 * env block from ts/.env.
 */
export function getDocumentationModel(endpoint?: string): ChatModel {
    return openai.createChatModel(endpoint, undefined, undefined, [
        "docs-autogen:documentation",
    ]);
}
