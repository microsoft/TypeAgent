// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
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
    ActionContextParams,
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
                getActionContextShim(param),
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
    const tokenCachePersistence: TokenCachePersistence = {
        load: async (): Promise<string> => {
            return rpc.invoke(AgentContextInvokeAPI.TokenCachePersistenceLoad, {
                contextId,
                session,
            });
        },
        save: async (data: string): Promise<void> => {
            return rpc.invoke(AgentContextInvokeAPI.TokenCachePersistenceSave, {
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

        getTokenCachePersistence: async () => {
            return tokenCachePersistence;
        },
    };
}

function createDispatcherAgentContextShim(
    contextId: number,
    hasSessionStorage: boolean,
    context: any,
): DispatcherAgentContext<any> {
    const agentIO: DispatcherAgentIO = {
        type: "text", // TODO: get the real value
        status: (message: string): void => {
            rpc.send(AgentContextCallAPI.AgentIOStatus, { contextId, message });
        },
        success: (message: string): void => {
            rpc.send(AgentContextCallAPI.AgentIOSuccess, {
                contextId,
                message,
            });
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
        agentIO,
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
        getUpdateActionStatus: ():
            | ((message: string, group_id: string) => void)
            | undefined => {
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

function getActionContextShim(
    param: Partial<ActionContextParams>,
): ActionContext<any> {
    const actionContextId = param.actionContextId;
    if (actionContextId === undefined) {
        throw new Error(
            "Invalid action context param: missing actionContextId",
        );
    }
    const sessionContext = getDispatcherAgentContextShim(param);
    return {
        get agentContext() {
            return sessionContext.context;
        },
        get sessionStorage() {
            return sessionContext.sessionStorage;
        },
        get profileStorage() {
            return sessionContext.profileStorage;
        },
        get sessionContext() {
            return sessionContext;
        },
        actionIO: {
            get type() {
                return sessionContext.agentIO.type;
            },
            setActionDisplay(content: string): void {
                rpc.send(AgentContextCallAPI.SetActionDisplay, {
                    actionContextId,
                    content,
                });
            },
        },
    };
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
