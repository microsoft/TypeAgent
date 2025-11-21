// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent } from "@typeagent/agent-sdk";
import { instantiate as instantiateChatAgent } from "./chatResponseHandler.js";

export function instantiate(): AppAgent {
    return instantiateChatAgent();
}

export {
    executeChatResponseAction,
    logEntities,
} from "./chatResponseHandler.js";
export type {
    ChatResponseAction,
    GenerateResponseAction,
} from "./chatResponseActionSchema.js";
