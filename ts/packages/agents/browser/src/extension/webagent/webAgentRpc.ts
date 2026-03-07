// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WebAgentRpcMessage,
    BuiltInWebAgentRpcRequest,
    isBuiltInWebAgentRpcResponse,
} from "../../common/webAgentMessageTypes.mjs";
import { CrosswordSchema } from "../contentScript/webAgentStorage";

export interface ExtractComponentRequest {
    type: string;
    userRequest?: string;
    url: string;
}

export interface ExtractComponentResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface PageState {
    url: string;
    title: string;
    readyState: DocumentReadyState;
}

const DEFAULT_RPC_TIMEOUT = 30000;

async function sendRpcToAgent(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number = DEFAULT_RPC_TIMEOUT,
): Promise<any> {
    return new Promise((resolve, reject) => {
        const requestId = `rpc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const listener = (event: MessageEvent) => {
            if (event.source !== window) return;

            const data = event.data;
            if (isBuiltInWebAgentRpcResponse(data) && data.id === requestId) {
                window.removeEventListener("message", listener);
                if (data.error) {
                    reject(new Error(data.error));
                } else {
                    resolve(data);
                }
            }
        };

        window.addEventListener("message", listener);

        const rpcRequest: BuiltInWebAgentRpcRequest = {
            type: "builtInRpc",
            id: requestId,
            method,
            params,
        };

        const message: WebAgentRpcMessage = {
            source: "webAgent",
            method: "webAgent/message",
            params: rpcRequest,
        };

        window.postMessage(message);

        setTimeout(() => {
            window.removeEventListener("message", listener);
            reject(new Error(`RPC timeout after ${timeoutMs}ms`));
        }, timeoutMs);
    });
}

export async function extractComponent<T>(
    type: string,
    userRequest?: string,
): Promise<T> {
    const response = await sendRpcToAgent("extractComponent", {
        type,
        userRequest,
        url: window.location.href,
    });

    if (!response.success) {
        throw new Error(response.error || "Failed to extract component");
    }

    return response.data as T;
}

export async function getPageState(): Promise<PageState> {
    return {
        url: window.location.href,
        title: document.title,
        readyState: document.readyState,
    };
}

const CROSSWORD_SCHEMA_TIMEOUT = 90000;

export async function extractCrosswordSchema(): Promise<CrosswordSchema> {
    const response = await sendRpcToAgent(
        "extractCrosswordSchema",
        { url: window.location.href },
        CROSSWORD_SCHEMA_TIMEOUT,
    );

    if (!response.success) {
        throw new Error(response.error || "Failed to extract crossword schema");
    }

    return response.data as CrosswordSchema;
}

export async function sendNotification(
    message: string,
    notificationId?: string,
): Promise<void> {
    await sendRpcToAgent("notify", {
        message,
        notificationId,
    });
}
