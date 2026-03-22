// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WebAgentRpcMessage,
    BuiltInWebAgentRpcRequest,
    isBuiltInWebAgentRpcResponse,
} from "../../common/webAgentMessageTypes.mjs";
import { CrosswordSchema } from "../contentScript/webAgentStorage";
import {
    PageComponentDefinition,
    COMMON_COMPONENTS,
} from "./common/pageComponents";

// Re-export for convenience
export type { PageComponentDefinition } from "./common/pageComponents";

export interface ExtractComponentRequest {
    typeName: string;
    schema: string;
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

const DEFAULT_RPC_TIMEOUT = 60000;

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

/**
 * Extract a page component using LLM-based extraction.
 *
 * @param componentDef - Either a PageComponentDefinition object or a string name of a common component
 * @param userRequest - Optional context for the extraction (e.g., "find the organic apples product")
 * @returns The extracted component data
 *
 * @example
 * // Using a common component
 * import { SearchInput } from "./common/pageComponents";
 * const search = await extractComponent<SearchInputType>(SearchInput);
 *
 * @example
 * // Using a custom component definition
 * const recipe = await extractComponent<RecipeType>({
 *     typeName: "Recipe",
 *     schema: `{ name: string; ingredients: string[]; }`
 * });
 *
 * @example
 * // Using a common component by name (backwards compatible)
 * const search = await extractComponent<SearchInputType>("SearchInput");
 */
export async function extractComponent<T>(
    componentDef: string | PageComponentDefinition,
    userRequest?: string,
): Promise<T> {
    let typeName: string;
    let schema: string;

    if (typeof componentDef === "string") {
        const builtIn = COMMON_COMPONENTS[componentDef];
        if (!builtIn) {
            throw new Error(
                `Unknown built-in component: "${componentDef}". ` +
                    `Available: ${Object.keys(COMMON_COMPONENTS).join(", ")}`,
            );
        }
        typeName = builtIn.typeName;
        schema = builtIn.schema;
    } else {
        typeName = componentDef.typeName;
        schema = componentDef.schema;
    }

    const rpcStart = performance.now();
    const response = await sendRpcToAgent("extractComponent", {
        typeName,
        schema,
        userRequest,
        url: window.location.href,
    });
    const rpcElapsed = (performance.now() - rpcStart).toFixed(0);

    if (!response.success) {
        console.log(
            `[WebAgentRpc] extractComponent(${typeName}) failed in ${rpcElapsed}ms`,
        );
        throw new Error(response.error || "Failed to extract component");
    }

    console.log(
        `[WebAgentRpc] extractComponent(${typeName}) completed in ${rpcElapsed}ms`,
        response.data,
    );

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
    const rpcStart = performance.now();
    const response = await sendRpcToAgent(
        "extractCrosswordSchema",
        { url: window.location.href },
        CROSSWORD_SCHEMA_TIMEOUT,
    );
    const rpcElapsed = (performance.now() - rpcStart).toFixed(0);

    if (!response.success) {
        console.log(
            `[WebAgentRpc] extractCrosswordSchema failed in ${rpcElapsed}ms`,
        );
        throw new Error(response.error || "Failed to extract crossword schema");
    }

    console.log(
        `[WebAgentRpc] extractCrosswordSchema completed in ${rpcElapsed}ms`,
    );
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
