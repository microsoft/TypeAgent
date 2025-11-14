// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";

export interface ExternalChatDelegationConfig {
    enabled: boolean;
}

export function isExternalChatDelegationEnabled(): boolean {
    const envValue = process.env.TYPEAGENT_EXTERNAL_CHAT_DELEGATION;
    if (envValue === undefined) {
        return true;
    }
    return envValue.toLowerCase() === "true" || envValue === "1";
}

export function isProtocolRequest(
    context: ActionContext<any>,
    requestId?: string,
): boolean {
    console.log(`[ChatDelegation] isProtocolRequest called with requestId: ${requestId}`);

    if (!requestId) {
        console.log(`[ChatDelegation] No requestId provided, returning false`);
        return false;
    }

    const agentContext = context.sessionContext.agentContext;
    console.log(`[ChatDelegation] agentContext exists: ${!!agentContext}`);
    console.log(`[ChatDelegation] agentContext type: ${typeof agentContext}`);

    if (agentContext && typeof agentContext === "object") {
        console.log(`[ChatDelegation] Has getProtocolRequestWebSocket: ${"getProtocolRequestWebSocket" in agentContext}`);
        console.log(`[ChatDelegation] Is function: ${typeof (agentContext as any).getProtocolRequestWebSocket === "function"}`);
    }

    if (
        agentContext &&
        typeof agentContext === "object" &&
        "getProtocolRequestWebSocket" in agentContext &&
        typeof (agentContext as any).getProtocolRequestWebSocket === "function"
    ) {
        const protocolInfo = (agentContext as any).getProtocolRequestWebSocket(
            requestId,
        );
        console.log(`[ChatDelegation] getProtocolRequestWebSocket returned: ${protocolInfo !== undefined ? "protocol info found" : "undefined"}`);
        return protocolInfo !== undefined;
    }

    console.log(`[ChatDelegation] agentContext does not have getProtocolRequestWebSocket method`);
    return false;
}

export function shouldDelegateToExternalChat(
    context: ActionContext<any>,
    requestId?: string,
): boolean {
    if (!isExternalChatDelegationEnabled()) {
        console.log(
            "[ChatDelegation] External chat delegation disabled via config",
        );
        return false;
    }

    const isProtocol = isProtocolRequest(context, requestId);
    if (isProtocol) {
        console.log(
            `[ChatDelegation] Protocol request ${requestId}, delegating to external chat`,
        );
    } else {
        console.log(
            `[ChatDelegation] Local request ${requestId}, processing with TypeAgent`,
        );
    }

    return isProtocol;
}

export function getConversationHistory(
    context: ActionContext<any>,
): Array<{ role: "user" | "assistant"; content: string }> {
    return [];
}
