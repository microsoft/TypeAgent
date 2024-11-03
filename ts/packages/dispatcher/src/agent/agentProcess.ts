// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    SessionContext,
    Storage,
    StorageEncoding,
    StorageListOptions,
    TokenCachePersistence,
    ActionIO,
    DisplayType,
    DisplayContent,
    DisplayAppendMode,
    AppAgentEvent,
    ParsedCommandParams,
    ParameterDefinitions,
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
import registerDebug from "debug";

const debug = registerDebug("typeagent:agentProcess");

const modulePath = process.argv[2];
const module = await import(modulePath);
if (typeof module.instantiate !== "function") {
    throw new Error(
        `Failed to load module agent ${modulePath}: missing 'instantiate' function.`,
    );
}

const agent: AppAgent = module.instantiate();

const agentInvokeHandlers: AgentInvokeFunctions = {
    async initializeAgentContext(): Promise<unknown> {
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
    async validateWildcardMatch(param): Promise<any> {
        if (agent.validateWildcardMatch === undefined) {
            throw new Error("Invalid invocation of validateWildcardMatch");
        }
        return agent.validateWildcardMatch(
            Action.fromJSONObject(param.action),
            getSessionContextShim(param),
        );
    },
    async getDynamicDisplay(param): Promise<any> {
        if (agent.getDynamicDisplay === undefined) {
            throw new Error("Invalid invocation of getDynamicDisplay");
        }
        return agent.getDynamicDisplay(
            param.type,
            param.displayId,
            getSessionContextShim(param),
        );
    },
    async closeAgentContext(param): Promise<any> {
        const result = await agent.closeAgentContext?.(
            getSessionContextShim(param),
        );
        unregisterAgentContext(param.agentContextId!);
        return result;
    },

    async getCommands(param): Promise<any> {
        if (agent.getCommands === undefined) {
            throw new Error("Invalid invocation of getCommands");
        }
        return agent.getCommands(getSessionContextShim(param));
    },
    async getCommandCompletion(param): Promise<string[]> {
        if (agent.getCommandCompletion === undefined) {
            throw new Error("Invalid invocation of getCommandCompletion");
        }
        return agent.getCommandCompletion(
            param.commands,
            param.params,
            param.names,
            getSessionContextShim(param),
        );
    },
    async executeCommand(param) {
        if (agent.executeCommand === undefined) {
            throw new Error("Invalid invocation of executeCommand");
        }
        return agent.executeCommand(
            param.commands,
            param.params,
            getActionContextShim(param),
        );
    },
    async getTemplateSchema(param) {
        if (agent.getTemplateSchema === undefined) {
            throw new Error("Invalid invocation of getTemplateSchema");
        }
        return agent.getTemplateSchema(
            param.templateName,
            param.data,
            getSessionContextShim(param),
        );
    },
    async getTemplateCompletion(param) {
        if (agent.getTemplateCompletion === undefined) {
            throw new Error("Invalid invocation of getTemplateCompletion");
        }
        return agent.getTemplateCompletion(
            param.templateName,
            param.data,
            param.propertyName,
            getSessionContextShim(param),
        );
    },
    async getActionCompletion(param) {
        if (agent.getActionCompletion === undefined) {
            throw new Error("Invalid invocation of getActionCompletion");
        }
        return agent.getActionCompletion(
            param.partialAction,
            param.propertyName,
            getSessionContextShim(param),
        );
    },
};

const agentCallHandlers: AgentCallFunctions = {
    async streamPartialAction(
        param: Partial<ContextParams> & {
            actionName: string;
            name: string;
            value: string;
            delta: string | undefined;
        },
    ): Promise<any> {
        if (agent.streamPartialAction === undefined) {
            throw new Error("Invalid invocation of streamPartialAction");
        }
        return agent.streamPartialAction(
            param.actionName,
            param.name,
            param.value,
            param.delta,
            getActionContextShim(param),
        );
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
>(checkedProcess, agentInvokeHandlers, agentCallHandlers);

function getStorage(contextId: number, session: boolean): Storage {
    const tokenCachePersistence: TokenCachePersistence = {
        load: async (): Promise<string> => {
            return rpc.invoke("tokenCacheRead", {
                contextId,
                session,
            });
        },
        save: async (token: string): Promise<void> => {
            return rpc.invoke("tokenCacheWrite", {
                contextId,
                session,
                token,
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
    return {
        agentContext: context,
        sessionStorage: hasSessionStorage
            ? getStorage(contextId, true)
            : undefined,
        profileStorage: getStorage(contextId, false),
        notify: (event: AppAgentEvent, message: string): void => {
            rpc.send("notify", {
                contextId,
                event,
                message,
            });
        },
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
        get type(): DisplayType {
            return "text";
        },
        setDisplay(content: DisplayContent): void {
            rpc.send("setDisplay", {
                actionContextId,
                content,
            });
        },
        appendDisplay(content: DisplayContent, mode: DisplayAppendMode): void {
            rpc.send("appendDisplay", {
                actionContextId,
                content,
                mode,
            });
        },
        takeAction(action: string) {
            rpc.send("takeAction", {
                actionContextId,
                action,
            });
        },
    };
    return {
        // streamingContext is only used by the agent, so it is not mirrored back to the dispatcher.
        streamingContext: undefined,
        get sessionContext() {
            return sessionContext;
        },
        get actionIO() {
            return actionIO;
        },
    };
}

const allAgentInterface = Object.keys(agentInvokeHandlers).concat(
    Object.keys(agentCallHandlers),
);

process.send!({
    type: "initialized",
    agentInterface: allAgentInterface.filter(
        (a: string) =>
            (agent as any)[a] !== undefined ||
            (a === "closeAgentContext" &&
                agent.initializeAgentContext !== undefined),
    ),
});

debug(`Agent process started: ${modulePath}`);
process.on("disconnect", () => {
    debug(`Parent process disconnected, exiting: ${modulePath}`);
    process.exit(-1);
});
