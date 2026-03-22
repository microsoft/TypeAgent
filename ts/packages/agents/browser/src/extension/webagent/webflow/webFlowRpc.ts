// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    BuiltInWebAgentRpcRequest,
    isBuiltInWebAgentRpcResponse,
    WebAgentRpcMessage,
} from "../../../common/webAgentMessageTypes.mjs";

export interface WebFlowParameterTransport {
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
    default?: unknown;
    valueOptions?: string[];
}

export interface WebFlowDefinitionTransport {
    name: string;
    description: string;
    parameters: Record<string, WebFlowParameterTransport>;
    script: string;
}

export interface WebFlowsResponse {
    flows: WebFlowDefinitionTransport[];
    lastUpdated: string;
    notModified?: boolean;
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

export async function getWebFlowsForDomain(
    domain: string,
    ifModifiedSince?: string,
): Promise<WebFlowsResponse> {
    try {
        const params: Record<string, unknown> = { domain };
        if (ifModifiedSince) {
            params.ifModifiedSince = ifModifiedSince;
        }
        const response = await sendRpcToAgent("getWebFlowsForDomain", params);
        return {
            flows: response.data?.flows ?? [],
            lastUpdated: response.data?.lastUpdated ?? "",
            notModified: response.data?.notModified ?? false,
        };
    } catch (error) {
        console.error(
            `[WebFlowRpc] getWebFlowsForDomain(${domain}) failed:`,
            error,
        );
        return { flows: [], lastUpdated: "" };
    }
}
