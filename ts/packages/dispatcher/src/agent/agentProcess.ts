// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DispatcherAgent,
    DispatcherAgentContext,
    DispatcherAgentIO,
    Storage,
    StorageEncoding,
    StorageListOptions,
    TokenCachePersistence,
} from "@typeagent/agent-sdk";

import { setupInvoke } from "./agentProcessUtil.js";
import {
    AgentContextCallAPI,
    AgentContextInvokeAPI,
    AgentInvokeAPI,
    ContextParams,
} from "./agentProcessTypes.js";
import { Action } from "agent-cache";

const modulePath = process.argv[2];
const module = await import(modulePath);
if (typeof module.instantiate !== "function") {
    throw new Error(
        `Failed to load module agent ${modulePath}: missing 'instantiate' function.`,
    );
}

const agent: DispatcherAgent = module.instantiate();

async function agentInvokeHandler(name: string, param: any): Promise<any> {
    switch (name) {
        case AgentInvokeAPI.InitializeAgentContext:
            if (agent.initializeAgentContext === undefined) {
                throw new Error("Invalid invocation of initializeAgentContext");
            }
            const agentContext = await agent.initializeAgentContext?.();
            return {
                contextId: registerAgentContext(agentContext),
            };
        case AgentInvokeAPI.UpdateAgentContext:
            if (agent.updateAgentContext === undefined) {
                throw new Error(
                    `Invalid invocation of ${AgentInvokeAPI.UpdateAgentContext}`,
                );
            }
            return agent.updateAgentContext(
                param.enable,
                getDispatcherAgentContextShim(param),
                param.translatorName,
            );
        case AgentInvokeAPI.ExecuteAction:
            if (agent.executeAction === undefined) {
                throw new Error("Invalid invocation of executeAction");
            }
            return agent.executeAction(
                Action.fromJSONObject(param.action),
                getDispatcherAgentContextShim(param),
                param.actionIndex,
            );

        case AgentInvokeAPI.PartialInput:
            if (agent.partialInput === undefined) {
                throw new Error("Invalid invocation of partialInput");
            }
            return agent.partialInput(
                param.text,
                getDispatcherAgentContextShim(param),
            );
        case AgentInvokeAPI.ValidateWildcardMatch:
            if (agent.validateWildcardMatch === undefined) {
                throw new Error("Invalid invocation of validateWildcardMatch");
            }
            return agent.validateWildcardMatch(
                param.action,
                getDispatcherAgentContextShim(param),
            );
        case AgentInvokeAPI.CloseAgentContext:
            const result = await agent.closeAgentContext?.(
                getDispatcherAgentContextShim(param),
            );
            unregisterAgentContext(param.agentContextId);
            return result;
        default:
            throw new Error(`Unknown invocation: ${name}`);
    }
}

const rpc = setupInvoke<AgentContextInvokeAPI, AgentContextCallAPI>(
    process,
    agentInvokeHandler,
);

function getStorage(contextId: number, session: boolean): Storage {
    return {
        read: (
            storagePath: string,
            options: StorageEncoding,
        ): Promise<string> => {
            return rpc.invoke(AgentContextInvokeAPI.StorageRead, {
                contextId,
                session,
                storagePath,
                options,
            });
        },
        write: (storagePath: string, data: string): Promise<void> => {
            return rpc.invoke(AgentContextInvokeAPI.StorageWrite, {
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
            return rpc.invoke(AgentContextInvokeAPI.StorageList, {
                contextId,
                session,
                storagePath,
                options,
            });
        },
        exists: (storagePath: string): Promise<boolean> => {
            return rpc.invoke(AgentContextInvokeAPI.StorageExists, {
                contextId,
                session,
                storagePath,
            });
        },
        delete: (storagePath: string): Promise<void> => {
            return rpc.invoke(AgentContextInvokeAPI.StorageDelete, {
                contextId,
                session,
                storagePath,
            });
        },

        getTokenCachePersistence: (): Promise<TokenCachePersistence> => {
            throw new Error("NYI");
        },
    };
}

function createDispatcherAgentContextShim(
    contextId: number,
    hasSessionStorage: boolean,
    context: any,
): DispatcherAgentContext<any> {
    const requestIO: DispatcherAgentIO = {
        type: "text",
        clear: (): void => {
            rpc.send(AgentContextCallAPI.AgentIOClear, { contextId });
        },
        info: (message: string): void => {
            rpc.send(AgentContextCallAPI.AgentIOInfo, { contextId, message });
        },
        status: (message: string): void => {
            rpc.send(AgentContextCallAPI.AgentIOStatus, { contextId, message });
        },
        success: (message: string): void => {
            rpc.send(AgentContextCallAPI.AgentIOSuccess, {
                contextId,
                message,
            });
        },
        warn: (message: string): void => {
            rpc.send(AgentContextCallAPI.AgentIOWarn, { contextId, message });
        },
        error: (message: string): void => {
            rpc.send(AgentContextCallAPI.AgentIOError, { contextId, message });
        },
        result: (message: string): void => {
            rpc.send(AgentContextCallAPI.AgentIOResult, { contextId, message });
        },
        setActionStatus: (
            message: string,
            actionIndex: number,
            groupId?: string,
        ): void => {
            rpc.send(AgentContextCallAPI.SetActionStatus, {
                contextId,
                message,
                actionIndex,
                groupId,
            });
        },
    };
    return {
        context,
        get currentTranslatorName(): string {
            throw new Error("NYI");
        },
        requestIO,
        get requestId(): string {
            throw new Error("NYI");
        },
        sessionStorage: hasSessionStorage
            ? getStorage(contextId, true)
            : undefined,
        profileStorage: getStorage(contextId, false),
        issueCommand: async (command: string): Promise<void> => {
            return rpc.invoke(AgentContextInvokeAPI.IssueCommand, {
                contextId,
                command,
            });
        },
        getAlternativeAgentContext: (name: string): any => {
            throw new Error("NYI");
        },
        getSessionDirPath: (): string | undefined => {
            throw new Error("NYI");
        },
        getUpdateActionStatus: ():
            | ((message: string, group_id: string) => void)
            | undefined => {
            throw new Error("NYI");
        },

        searchMenuCommand: (
            menuId: string,
            command: any, // TODO: Fix the type
            prefix?: string,
            choices?: any[], // TODO: Fix the type
            visible?: boolean,
        ): void => {
            throw new Error("NYI");
        },
        toggleAgent: async (name: string, enable: boolean): Promise<void> => {
            return rpc.invoke(AgentContextInvokeAPI.ToggleAgent, {
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

function getDispatcherAgentContextShim(
    param: Partial<ContextParams>,
): DispatcherAgentContext {
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

    return createDispatcherAgentContextShim(
        contextId,
        hasSessionStorage,
        agentContext,
    );
}

process.send!({
    type: "initialized",
    agentInterface: Object.values(AgentInvokeAPI).filter(
        (a) =>
            agent[a] !== undefined ||
            (a === AgentInvokeAPI.CloseAgentContext &&
                agent.initializeAgentContext !== undefined),
    ),
});
