// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chlid_process from "child_process";
import { DispatcherAgent, DispatcherAgentContext } from "@typeagent/agent-sdk";
import {
    AgentContextCallAPI,
    AgentContextInvokeAPI,
    AgentInvokeAPI,
    ContextParams,
    ShimContext,
} from "./agentProcessTypes.js";
import { setupInvoke } from "./agentProcessUtil.js";
import { fileURLToPath } from "url";

export async function createAgentProcessShim(
    modulePath: string,
): Promise<DispatcherAgent> {
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
    let nextContextId = 0;
    const contextIdMap = new Map<DispatcherAgentContext<ShimContext>, number>();
    const contextMap = new Map<number, DispatcherAgentContext<ShimContext>>();
    async function withContext(
        context: DispatcherAgentContext<ShimContext>,
        fn: (contextParams: ContextParams) => Promise<any>,
    ) {
        let contextId = contextIdMap.get(context);
        if (contextId === undefined) {
            contextId = nextContextId++;
            contextIdMap.set(context, contextId);
            contextMap.set(contextId, context);
        }

        return fn({
            contextId,
            hasSessionStorage: context.sessionStorage !== undefined,
            agentContextId: context.context?.contextId,
        });
    }

    function getContext(contextId: number) {
        const context = contextMap.get(contextId);
        if (context === undefined) {
            throw new Error(
                `Internal error: Invalid contextId ${contextId}${contextId < nextContextId ? " used after action" : ""}`,
            );
        }
        return context;
    }
    function getStorage(param: any, context: DispatcherAgentContext) {
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
        const context = getContext(param.contextId);
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
            default:
                throw new Error(`Unknown invocation: ${name}`);
        }
    }

    function agentContextCallHandler(name: string, param: any) {
        const context = getContext(param.contextId);
        switch (name) {
            case AgentContextCallAPI.AgentIOClear:
                context.requestIO.clear();
                break;
            case AgentContextCallAPI.AgentIOInfo:
                context.requestIO.info(param.message);
                return;
            case AgentContextCallAPI.AgentIOStatus:
                context.requestIO.status(param.message);
                return;
            case AgentContextCallAPI.AgentIOSuccess:
                context.requestIO.success(param.message);
                return;
            case AgentContextCallAPI.AgentIOWarn:
                context.requestIO.warn(param.message);
                return;
            case AgentContextCallAPI.AgentIOError:
                context.requestIO.error(param.message);
                return;
            case AgentContextCallAPI.AgentIOResult:
                context.requestIO.result(param.message);
                return;
            default:
                throw new Error(`Unknown invocation: ${name}`);
        }
    }

    const rpc = setupInvoke<AgentInvokeAPI>(
        process,
        agentContextInvokeHandler,
        agentContextCallHandler,
    );

    const agent: DispatcherAgent = {
        initializeAgentContext(): Promise<ShimContext> {
            return rpc.invoke(AgentInvokeAPI.InitializeAgentContext);
        },
        updateAgentContext(
            enable,
            context: DispatcherAgentContext<ShimContext>,
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
        executeAction(
            action,
            context: DispatcherAgentContext<ShimContext>,
            actionIndex,
        ) {
            return withContext(context, (contextParams) =>
                rpc.invoke(AgentInvokeAPI.ExecuteAction, {
                    ...contextParams,
                    action,
                    actionIndex,
                }),
            );
        },
        partialInput(text, context: DispatcherAgentContext) {
            return withContext(context, (contextParams) =>
                rpc.invoke(AgentInvokeAPI.PartialInput, {
                    ...contextParams,
                    text,
                }),
            );
        },
        validateWildcardMatch(action, context: DispatcherAgentContext) {
            return withContext(context, (contextParams) =>
                rpc.invoke(AgentInvokeAPI.ValidateWildcardMatch, {
                    ...contextParams,
                    action,
                }),
            );
        },
        closeAgentContext(context: DispatcherAgentContext) {
            return withContext(context, (contextParams) =>
                rpc.invoke(AgentInvokeAPI.CloseAgentContext, {
                    ...contextParams,
                }),
            );
        },
    };

    const result: DispatcherAgent = Object.fromEntries(
        agentInterface.map((name) => [name, agent[name]]),
    );

    const invokeCloseAgentContext = result.closeAgentContext;
    result.closeAgentContext = async (context) => {
        const result = await invokeCloseAgentContext?.(context);
        const contextId = contextIdMap.get(context);
        if (contextId !== undefined) {
            contextIdMap.delete(context);
            contextMap.delete(contextId);
        }
        return result;
    };
    return result;
}
