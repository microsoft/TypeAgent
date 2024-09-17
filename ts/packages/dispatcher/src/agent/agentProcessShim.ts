// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import child_process from "child_process";
import {
    AppAgent,
    ActionContext,
    SessionContext,
    StorageListOptions,
    AppAgentEvent,
    CommandDescriptor,
    CommandDescriptorTable,
    DisplayContent,
    DisplayAppendMode,
} from "@typeagent/agent-sdk";
import {
    AgentCallFunctions,
    AgentContextCallFunctions,
    AgentContextInvokeFunctions,
    AgentInvokeFunctions,
    ContextParams,
} from "./agentProcessTypes.js";
import { createRpc } from "common-utils";
import { fileURLToPath } from "url";

type ShimContext =
    | {
          contextId: number;
      }
    | undefined;

function createContextMap<T>() {
    let nextContextId = 0;
    let contextIdMap = new Map<T, number>();
    let contextMap = new Map<number, T>();

    function getId(context: T) {
        let contextId = contextIdMap.get(context);
        if (contextId === undefined) {
            contextId = nextContextId++;
            contextIdMap.set(context, contextId);
            contextMap.set(contextId, context);
        }
        return contextId;
    }
    function get(contextId: number) {
        const context = contextMap.get(contextId);
        if (context === undefined) {
            throw new Error(
                `Internal error: Invalid contextId ${contextId}${contextId < nextContextId ? " used out of scope" : ""}`,
            );
        }
        return context;
    }

    function close(context: T) {
        const contextId = contextIdMap.get(context);
        if (contextId !== undefined) {
            contextIdMap.delete(context);
            contextMap.delete(contextId);
        }
    }
    return {
        getId,
        get,
        close,
    };
}
export async function createAgentProcessShim(
    modulePath: string,
): Promise<AppAgent> {
    const process = child_process.fork(
        fileURLToPath(new URL(`./agentProcess.js`, import.meta.url)),
        [modulePath],
    );
    const agentInterface = await new Promise<(keyof AgentInvokeFunctions)[]>(
        (resolve, reject) => {
            process.once("message", (message: any) => {
                if (message.type === "initialized") {
                    resolve(message.agentInterface);
                } else {
                    reject(new Error(`Unexpected message: ${message.type}`));
                }
            });
        },
    );
    const contextMap = createContextMap<SessionContext<ShimContext>>();
    function getContextParam(
        context: SessionContext<ShimContext>,
    ): ContextParams {
        return {
            contextId: contextMap.getId(context),
            hasSessionStorage: context.sessionStorage !== undefined,
            agentContextId: context.agentContext?.contextId,
        };
    }

    const actionContextMap = createContextMap<ActionContext<ShimContext>>();
    function withActionContext<T>(
        actionContext: ActionContext<ShimContext>,
        fn: (contextParams: { actionContextId: number }) => T,
    ) {
        try {
            return fn({
                actionContextId: actionContextMap.getId(actionContext),
                ...getContextParam(actionContext.sessionContext),
            });
        } finally {
            actionContextMap.close(actionContext);
        }
    }
    async function withActionContextAsync<T>(
        actionContext: ActionContext<ShimContext>,
        fn: (contextParams: { actionContextId: number }) => Promise<T>,
    ) {
        try {
            return await fn({
                actionContextId: actionContextMap.getId(actionContext),
                ...getContextParam(actionContext.sessionContext),
            });
        } finally {
            actionContextMap.close(actionContext);
        }
    }
    function getStorage(
        param: {
            session: boolean;
        },
        context: SessionContext,
    ) {
        const storage = param.session
            ? context.sessionStorage
            : context.profileStorage;
        if (storage === undefined) {
            throw new Error("Storage not available");
        }
        return storage;
    }

    const agentContextInvokeHandlers: AgentContextInvokeFunctions = {
        toggleTransientAgent: async (param: {
            contextId: number;
            name: string;
            enable: boolean;
        }) => {
            const context = contextMap.get(param.contextId);
            return context.toggleTransientAgent(param.name, param.enable);
        },
        storageRead: async (param: {
            contextId: number;
            session: boolean;
            storagePath: string;
            options: any;
        }) => {
            const context = contextMap.get(param.contextId);
            return getStorage(param, context).read(
                param.storagePath,
                param.options,
            );
        },
        storageWrite: async (param: {
            contextId: number;
            session: boolean;
            storagePath: string;
            data: string;
        }) => {
            const context = contextMap.get(param.contextId);
            return getStorage(param, context).write(
                param.storagePath,
                param.data,
            );
        },
        storageList: async (param: {
            contextId: number;
            session: boolean;
            storagePath: string;
            options: StorageListOptions;
        }) => {
            const context = contextMap.get(param.contextId);
            return getStorage(param, context).list(
                param.storagePath,
                param.options,
            );
        },
        storageExists: async (param: {
            contextId: number;
            session: boolean;
            storagePath: string;
        }) => {
            const context = contextMap.get(param.contextId);
            return getStorage(param, context).exists(param.storagePath);
        },
        storageDelete: async (param: {
            contextId: number;
            session: boolean;
            storagePath: string;
        }) => {
            const context = contextMap.get(param.contextId);
            return getStorage(param, context).delete(param.storagePath);
        },
        tokenCacheRead: async (param: {
            contextId: number;
            session: boolean;
        }) => {
            const context = contextMap.get(param.contextId);
            const storage = getStorage(param, context);
            return (await storage.getTokenCachePersistence()).load();
        },
        tokenCacheWrite: async (param: {
            contextId: number;
            session: boolean;
            token: string;
        }) => {
            const context = contextMap.get(param.contextId);
            const storage = getStorage(param, context);
            return (await storage.getTokenCachePersistence()).save(param.token);
        },
    };

    const agentContextCallHandlers: AgentContextCallFunctions = {
        notify: (param: {
            contextId: number;
            event: AppAgentEvent;
            message: string;
        }) => {
            contextMap.get(param.contextId).notify(param.event, param.message);
        },
        setDisplay: (param: {
            actionContextId: number;
            message: DisplayContent;
        }) => {
            actionContextMap
                .get(param.actionContextId)
                .actionIO.setDisplay(param.message);
        },
        appendDisplay: (param: {
            actionContextId: number;
            message: DisplayContent;
            mode: DisplayAppendMode;
        }) => {
            actionContextMap
                .get(param.actionContextId)
                .actionIO.appendDisplay(param.message, param.mode);
        },
    };

    const rpc = createRpc<
        AgentInvokeFunctions,
        AgentCallFunctions,
        AgentContextInvokeFunctions,
        AgentContextCallFunctions
    >(process, agentContextInvokeHandlers, agentContextCallHandlers);

    const agent: AppAgent = {
        initializeAgentContext(): Promise<ShimContext> {
            return rpc.invoke("initializeAgentContext");
        },
        updateAgentContext(
            enable,
            context: SessionContext<ShimContext>,
            translatorName,
        ) {
            return rpc.invoke("updateAgentContext", {
                ...getContextParam(context),
                enable,
                translatorName,
            });
        },
        executeAction(action, context: ActionContext<ShimContext>) {
            return withActionContextAsync(context, (contextParams) =>
                rpc.invoke("executeAction", {
                    ...contextParams,
                    action,
                }),
            );
        },
        validateWildcardMatch(action, context: SessionContext<ShimContext>) {
            return rpc.invoke("validateWildcardMatch", {
                ...getContextParam(context),
                action,
            });
        },
        streamPartialAction(
            actionName: string,
            name: string,
            value: string,
            delta: string | undefined,
            context: ActionContext<ShimContext>,
        ) {
            return withActionContext(context, (contextParams) =>
                rpc.send("streamPartialAction", {
                    ...contextParams,
                    actionName,
                    name,
                    value,
                    delta,
                }),
            );
        },
        getDynamicDisplay(
            type,
            displayId,
            context: SessionContext<ShimContext>,
        ) {
            return rpc.invoke("getDynamicDisplay", {
                ...getContextParam(context),
                type,
                displayId,
            });
        },
        closeAgentContext(context: SessionContext<ShimContext>) {
            return rpc.invoke("closeAgentContext", getContextParam(context));
        },

        getCommands(
            context: SessionContext<ShimContext>,
        ): Promise<CommandDescriptor | CommandDescriptorTable> {
            return rpc.invoke("getCommands", getContextParam(context));
        },
        executeCommand(
            commands: string[],
            args: string,
            context: ActionContext<ShimContext>,
        ) {
            return withActionContextAsync(context, (contextParams) =>
                rpc.invoke("executeCommand", {
                    ...contextParams,
                    commands,
                    args,
                }),
            );
        },
    };

    const result: AppAgent = Object.fromEntries(
        agentInterface.map((name) => [name, agent[name]]),
    );

    const invokeCloseAgentContext = result.closeAgentContext;
    result.closeAgentContext = async (context: SessionContext<ShimContext>) => {
        const result = await invokeCloseAgentContext?.(context);
        contextMap.close(context);
        return result;
    };
    return result;
}
