// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chlid_process from "child_process";
import { AppAgent, ActionContext, SessionContext } from "@typeagent/agent-sdk";
import {
    AgentCallAPI,
    AgentContextCallAPI,
    AgentContextInvokeAPI,
    AgentInvokeAPI,
    ContextParams,
    ShimContext,
} from "./agentProcessTypes.js";
import { setupInvoke } from "./agentProcessUtil.js";
import { fileURLToPath } from "url";

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
    const process = chlid_process.fork(
        fileURLToPath(new URL(`./agentProcess.js`, import.meta.url)),
        [modulePath],
    );
    const agentInterface = await new Promise<AgentInvokeAPI[]>(
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
    function withContext<T>(
        context: SessionContext<ShimContext>,
        fn: (contextParams: ContextParams) => T,
    ) {
        return fn({
            contextId: contextMap.getId(context),
            hasSessionStorage: context.sessionStorage !== undefined,
            agentContextId: context.agentContext?.contextId,
        });
    }

    const actionContextMap = createContextMap<ActionContext<ShimContext>>();
    function withActionContext<T>(
        actionContext: ActionContext<ShimContext>,
        fn: (contextParams: { actionContextId: number }) => T,
    ) {
        return withContext(
            actionContext.sessionContext,
            async (contextParams) => {
                try {
                    return await fn({
                        actionContextId: actionContextMap.getId(actionContext),
                        ...contextParams,
                    });
                } finally {
                    actionContextMap.close(actionContext);
                }
            },
        );
    }
    function getStorage(param: any, context: SessionContext) {
        const storage = param.session
            ? context.sessionStorage
            : context.profileStorage;
        if (storage === undefined) {
            throw new Error("Storage not available");
        }
        return storage;
    }

    async function agentContextInvokeHandler(
        name: string,
        param: any,
    ): Promise<any> {
        const context = contextMap.get(param.contextId);
        switch (name) {
            case AgentContextInvokeAPI.IssueCommand:
                return context.issueCommand(param.command);
            case AgentContextInvokeAPI.ToggleAgent:
                return context.toggleAgent(param.name, param.enable);
            case AgentContextInvokeAPI.StorageRead:
                return getStorage(param, context).read(
                    param.storagePath,
                    param.options,
                );
            case AgentContextInvokeAPI.StorageWrite:
                return getStorage(param, context).write(
                    param.storagePath,
                    param.data,
                );
            case AgentContextInvokeAPI.StorageList:
                return getStorage(param, context).list(
                    param.storagePath,
                    param.options,
                );
            case AgentContextInvokeAPI.StorageExists:
                return getStorage(param, context).exists(param.storagePath);
            case AgentContextInvokeAPI.StorageDelete:
                return getStorage(param, context).delete(param.storagePath);
            case AgentContextInvokeAPI.TokenCachePersistenceLoad:
                return (
                    await getStorage(param, context).getTokenCachePersistence()
                ).load();
            case AgentContextInvokeAPI.TokenCachePersistenceSave:
                return (
                    await getStorage(param, context).getTokenCachePersistence()
                ).load();
            default:
                throw new Error(`Unknown invocation: ${name}`);
        }
    }

    function agentContextCallHandler(name: string, param: any) {
        switch (name) {
            case AgentContextCallAPI.AgentIOStatus:
                contextMap.get(param.contextId).agentIO.status(param.message);
                return;
            case AgentContextCallAPI.AgentIOSuccess:
                contextMap.get(param.contextId).agentIO.success(param.message);
                return;
            case AgentContextCallAPI.SetActionDisplay:
                actionContextMap
                    .get(param.actionContextId)
                    .actionIO.setActionDisplay(param.content);
            default:
                throw new Error(`Unknown invocation: ${name}`);
        }
    }

    const rpc = setupInvoke<AgentInvokeAPI, AgentCallAPI>(
        process,
        agentContextInvokeHandler,
        agentContextCallHandler,
    );

    const agent: AppAgent = {
        initializeAgentContext(): Promise<ShimContext> {
            return rpc.invoke(AgentInvokeAPI.InitializeAgentContext);
        },
        updateAgentContext(
            enable,
            context: SessionContext<ShimContext>,
            translatorName,
        ) {
            return withContext(context, (contextParams) =>
                rpc.invoke(AgentInvokeAPI.UpdateAgentContext, {
                    ...contextParams,
                    enable,
                    translatorName,
                }),
            );
        },
        executeAction(action, context: ActionContext<ShimContext>) {
            return withActionContext(context, (contextParams) =>
                rpc.invoke(AgentInvokeAPI.ExecuteAction, {
                    ...contextParams,
                    action,
                }),
            );
        },
        validateWildcardMatch(action, context: SessionContext) {
            return withContext(context, (contextParams) =>
                rpc.invoke(AgentInvokeAPI.ValidateWildcardMatch, {
                    ...contextParams,
                    action,
                }),
            );
        },
        streamPartialAction(
            actionName: string,
            name: string,
            value: string,
            partial: boolean,
            context: SessionContext,
        ) {
            return withContext(context, (contextParams) =>
                rpc.send(AgentCallAPI.StreamPartialAction, {
                    ...contextParams,
                    actionName,
                    name,
                    value,
                    partial,
                }),
            );
        },
        getDynamicDisplay(type, displayId, context) {
            return withContext(context, (contextParams) =>
                rpc.invoke(AgentInvokeAPI.GetDynamicDisplay, {
                    ...contextParams,
                    type,
                    displayId,
                }),
            );
        },
        closeAgentContext(context: SessionContext) {
            return withContext(context, (contextParams) =>
                rpc.invoke(AgentInvokeAPI.CloseAgentContext, {
                    ...contextParams,
                }),
            );
        },
    };

    const result: AppAgent = Object.fromEntries(
        agentInterface.map((name) => [name, agent[name]]),
    );

    const invokeCloseAgentContext = result.closeAgentContext;
    result.closeAgentContext = async (context) => {
        const result = await invokeCloseAgentContext?.(context);
        contextMap.close(context);
        return result;
    };
    return result;
}
