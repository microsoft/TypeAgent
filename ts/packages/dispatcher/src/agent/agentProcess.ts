// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    SessionContext,
    AppAgentIO,
    Storage,
    StorageEncoding,
    StorageListOptions,
    TokenCachePersistence,
    ActionIO,
    DisplayType,
} from "@typeagent/agent-sdk";

import { createRpc } from "common-utils";

import {
    ActionContextParams,
    AgentCallFunctions,
    AgentContextCallFunctions,
    AgentContextInvokeFunctions,
    AgentInvokeFunctions,
    ContextParams,
} from "./agentProcessTypes.js";
import { Action, JSONAction } from "agent-cache";

const modulePath = process.argv[2];
const module = await import(modulePath);
if (typeof module.instantiate !== "function") {
    throw new Error(
        `Failed to load module agent ${modulePath}: missing 'instantiate' function.`,
    );
}

const agent: AppAgent = module.instantiate();

const agentInvokeHandler: AgentInvokeFunctions = {
    async initializeAgentContext(): Promise<any> {
        if (agent.initializeAgentContext === undefined) {
            throw new Error("Invalid invocation of initializeAgentContext");
        }
        const agentContext = await agent.initializeAgentContext?.();
        return {
            contextId: registerAgentContext(agentContext),
        };
    },
    async updateAgentContext(
        param: Partial<ContextParams> & {
            enable: boolean;
            translatorName: string;
        },
    ): Promise<any> {
        if (agent.updateAgentContext === undefined) {
            throw new Error(`Invalid invocation of updateAgentContext`);
        }
        return agent.updateAgentContext(
            param.enable,
            getSessionContextShim(param),
            param.translatorName,
        );
    },
    async executeAction(
        param: Partial<ActionContextParams> & { action: JSONAction },
    ): Promise<any> {
        if (agent.executeAction === undefined) {
            throw new Error("Invalid invocation of executeAction");
        }
        return agent.executeAction(
            Action.fromJSONObject(param.action),
            getActionContextShim(param),
        );
    },
    async validateWildcardMatch(
        param: Partial<ContextParams> & { action: JSONAction },
    ): Promise<any> {
        if (agent.validateWildcardMatch === undefined) {
            throw new Error("Invalid invocation of validateWildcardMatch");
        }
        return agent.validateWildcardMatch(
            Action.fromJSONObject(param.action),
            getSessionContextShim(param),
        );
    },
    async getDynamicDisplay(
        param: Partial<ContextParams> & {
            type: DisplayType;
            displayId: string;
        },
    ): Promise<any> {
        if (agent.getDynamicDisplay === undefined) {
            throw new Error("Invalid invocation of getDynamicDisplay");
        }
        return agent.getDynamicDisplay(
            param.type,
            param.displayId,
            getSessionContextShim(param),
        );
    },
    async streamPartialAction(
        param: Partial<ContextParams> & {
            actionName: string;
            type: string;
            displayId: string;
            partial: boolean;
        },
    ): Promise<any> {
        if (agent.streamPartialAction === undefined) {
            throw new Error("Invalid invocation of streamPartialAction");
        }
        return agent.streamPartialAction(
            param.actionName,
            param.type,
            param.displayId,
            param.partial,
            getSessionContextShim(param),
        );
    },
    async closeAgentContext(param: Partial<ContextParams>): Promise<any> {
        const result = await agent.closeAgentContext?.(
            getSessionContextShim(param),
        );
        unregisterAgentContext(param.agentContextId!);
        return result;
    },
};

if (process.send === undefined) {
    throw new Error("No IPC channel to parent process");
}

const checkedProcess = process as NodeJS.Process & {
    send: (message: any) => void;
};

const rpc = createRpc<
    AgentContextInvokeFunctions,
    AgentContextCallFunctions,
    AgentInvokeFunctions,
    AgentCallFunctions
>(checkedProcess, agentInvokeHandler);

function getStorage(contextId: number, session: boolean): Storage {
    const tokenCachePersistence: TokenCachePersistence = {
        load: async (): Promise<string> => {
            return rpc.invoke("tokenCacheRead", {
                contextId,
                session,
            });
        },
        save: async (data: string): Promise<void> => {
            return rpc.invoke("tokenCacheWrite", {
                contextId,
                session,
                data,
            });
        },
    };
    return {
        read: (
            storagePath: string,
            options: StorageEncoding,
        ): Promise<string> => {
            return rpc.invoke("storageRead", {
                contextId,
                session,
                storagePath,
                options,
            });
        },
        write: (storagePath: string, data: string): Promise<void> => {
            return rpc.invoke("storageWrite", {
                contextId,
                session,
                storagePath,
                data,
            });
        },
        list: (
            storagePath: string,
            options?: StorageListOptions,
        ): Promise<string[]> => {
            return rpc.invoke("storageList", {
                contextId,
                session,
                storagePath,
                options,
            });
        },
        exists: (storagePath: string): Promise<boolean> => {
            return rpc.invoke("storageExists", {
                contextId,
                session,
                storagePath,
            });
        },
        delete: (storagePath: string): Promise<void> => {
            return rpc.invoke("storageDelete", {
                contextId,
                session,
                storagePath,
            });
        },

        getTokenCachePersistence: async () => {
            return tokenCachePersistence;
        },
    };
}

function createSessionContextShim(
    contextId: number,
    hasSessionStorage: boolean,
    context: any,
): SessionContext<any> {
    const agentIO: AppAgentIO = {
        type: "text", // TODO: get the real value
        status: (message: string): void => {
            rpc.send("agentIOStatus", { contextId, message });
        },
        success: (message: string): void => {
            rpc.send("agentIOSuccess", {
                contextId,
                message,
            });
        },
        setActionStatus: (message: string, actionIndex: number): void => {
            rpc.send("setActionStatus", {
                contextId,
                message,
                actionIndex,
            });
        },
    };
    return {
        agentContext: context,
        agentIO,
        sessionStorage: hasSessionStorage
            ? getStorage(contextId, true)
            : undefined,
        profileStorage: getStorage(contextId, false),
        toggleTransientAgent: async (
            name: string,
            enable: boolean,
        ): Promise<void> => {
            return rpc.invoke("toggleTransientAgent", {
                contextId,
                name,
                enable,
            });
        },
    };
}

let nextAgentContextId = 0;
const agentContexts = new Map<number, any>();
function registerAgentContext(agentContext: any): number {
    const agentContextId = nextAgentContextId++;
    agentContexts.set(agentContextId, agentContext);
    return agentContextId;
}

function unregisterAgentContext(agentContextId: number) {
    agentContexts.delete(agentContextId);
}

function getAgentContext(agentContextId: number) {
    const agentContext = agentContexts.get(agentContextId);
    if (agentContext === undefined) {
        throw new Error(`Invalid agent context ID: ${agentContextId}`);
    }
    return agentContext;
}

function getSessionContextShim(param: Partial<ContextParams>): SessionContext {
    const { contextId, hasSessionStorage, agentContextId } = param;
    if (contextId === undefined) {
        throw new Error("Invalid context param: missing contextId");
    }
    if (hasSessionStorage === undefined) {
        throw new Error("Invalid context param: missing hasSessionStorage");
    }

    const agentContext =
        agentContextId !== undefined
            ? getAgentContext(agentContextId)
            : undefined;

    return createSessionContextShim(contextId, hasSessionStorage, agentContext);
}

function getActionContextShim(
    param: Partial<ActionContextParams>,
): ActionContext<any> {
    const actionContextId = param.actionContextId;
    if (actionContextId === undefined) {
        throw new Error(
            "Invalid action context param: missing actionContextId",
        );
    }
    const sessionContext = getSessionContextShim(param);
    const actionIO: ActionIO = {
        get type() {
            return sessionContext.agentIO.type;
        },
        setActionDisplay(content: string): void {
            rpc.send("setActionDisplay", {
                actionContextId,
                content,
            });
        },
    };
    return {
        get sessionContext() {
            return sessionContext;
        },
        get actionIO() {
            return actionIO;
        },
        performanceMark: (name: string): void => {
            rpc.send("performanceMark", {
                actionContextId,
                name,
            });
        },
    };
}

process.send!({
    type: "initialized",
    agentInterface: Object.keys(agentInvokeHandler).filter(
        (a: string) =>
            (agent as any)[a] !== undefined ||
            (a === "closeAgentContext" &&
                agent.initializeAgentContext !== undefined),
    ),
});
