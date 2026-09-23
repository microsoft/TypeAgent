// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    StructuredActionClient,
    type StructuredActionClientOptions,
} from "@typeagent/agent-server-client";
import { randomUUID } from "node:crypto";
import { createClientIO, TYPEAGENT_URL } from "./typeagent-client.js";
import { getConversationId, isMixedMcpMode } from "./plugin-config.js";

/** Plugin configuration only; transport and private binding live in the client package. */
export function createStructuredActionClient(
    connect?: StructuredActionClientOptions["connect"],
): StructuredActionClient {
    const conversationId = getConversationId();
    const clientIO = createClientIO({});
    return new StructuredActionClient({
        url: TYPEAGENT_URL,
        clientIO,
        ...(connect === undefined ? {} : { connect }),
        resolveConversationId: async (connection) => {
            if (!isMixedMcpMode()) return undefined;
            // Resolve the same default as NL, then explicitly create a separate
            // structured owner. Sharing conversation data does not share approval.
            const joined = await connection.joinConversation(clientIO, {
                filter: true,
                clientType: "shell",
            });
            await connection.leaveConversation(joined.conversationId);
            return joined.conversationId;
        },
        createConversationName: () =>
            `Copilot structured actions ${randomUUID()}`,
        ...(conversationId === undefined ? {} : { conversationId }),
    });
}
