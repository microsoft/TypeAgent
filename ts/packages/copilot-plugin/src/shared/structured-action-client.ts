// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    StructuredActionClient,
    StructuredActionClientError,
    type StructuredActionClientOptions,
} from "@typeagent/agent-server-client";
import { createClientIO, TYPEAGENT_URL } from "./typeagent-client.js";
import { getConversationId } from "./plugin-config.js";
import {
    readSelectedConversationId,
    selectConversationId,
} from "./conversation-selection.js";

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
        ...(conversationId === undefined ? {} : { conversationId }),
        resolveConversationId: (connection) =>
            selectConversationId(connection, clientIO, TYPEAGENT_URL),
        validateConversationId: async (conversationId) => {
            if (
                (await readSelectedConversationId(TYPEAGENT_URL)) !==
                conversationId
            ) {
                throw new StructuredActionClientError(
                    false,
                    "conversation_changed",
                );
            }
        },
    });
}
