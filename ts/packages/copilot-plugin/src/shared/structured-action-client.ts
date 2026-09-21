// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { StructuredActionClient } from "@typeagent/agent-server-client";
import { randomUUID } from "node:crypto";
import { createClientIO, TYPEAGENT_URL } from "./typeagent-client.js";
import { readConfig } from "./plugin-config.js";

/** Plugin configuration only; transport and private binding live in the client package. */
export function createStructuredActionClient(): StructuredActionClient {
    const conversationId =
        process.env.TYPEAGENT_CONVERSATION_ID ?? readConfig()?.conversationId;
    return new StructuredActionClient({
        url: TYPEAGENT_URL,
        clientIO: createClientIO({}),
        createConversationName: () =>
            `Copilot structured actions ${randomUUID()}`,
        ...(conversationId === undefined ? {} : { conversationId }),
    });
}
