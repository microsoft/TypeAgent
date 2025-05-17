// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    ActionContext,
    SessionContext,
    StorageListOptions,
    AppAgentEvent,
    DisplayContent,
    DisplayAppendMode,
    CommandDescriptors,
    ParsedCommandParams,
    ParameterDefinitions,
    ClientAction,
    AppAgentManifest,
    AppAction,
    TypeAgentAction,
    StorageEncoding,
    AppAgentInitSettings,
} from "@typeagent/agent-sdk";
import {
    ActionContextParams,
    AgentCallFunctions,
    AgentContextCallFunctions,
    AgentContextInvokeFunctions,
    AgentInvokeFunctions,
    ContextParams,
} from "./types.js";
import { createRpc } from "./rpc.js";
import { ChannelProvider } from "./common.js";
import { uint8ArrayToBase64 } from "common-utils";
import { AgentInterfaceFunctionName } from "./server.js";

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

export async function createAgentRpcClient(
    name: string,
    channelProvider: ChannelProvider,
    agentInterface: AgentInterfaceFunctionName[],
) {
    const channel = channelProvider.createChannel(`agent:${name}`);
    const contextMap = createContextMap<SessionContext<ShimContext>>();
    function getContextParam(
        context: SessionContext<ShimContext>,
    ): ContextParams {
        return {
            contextId: contextMap.getId(context),
            hasInstanceStorage: context.instanceStorage !== undefined,
            hasSessionStorage: context.sessionStorage !== undefined,
            agentContextId: context.agentContext?.contextId,
        };
    }

    const actionContextMap = createContextMap<ActionContext<ShimContext>>();
    function withActionContext<T>(
        actionContext: ActionContext<ShimContext>,
        fn: (contextParams: ActionContextParams) => T,
    ) {
        try {
            return fn({
                actionContextId: actionContextMap.getId(actionContext),
                activityContext: actionContext.activityContext,
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
            : context.instanceStorage;
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
        addDynamicAgent: async (param: {
            contextId: number;
            name: string;
            manifest: AppAgentManifest;
            agentInterface: AgentInterfaceFunctionName[];
        }) => {
            const context = contextMap.get(param.contextId);
            try {
                await context.addDynamicAgent(
                    param.name,
                    param.manifest,
                    await createAgentRpcClient(
                        param.name,
                        channelProvider,
                        agentInterface,
                    ),
                );
            } catch (e: any) {
                // Clean up the channel if adding the agent fails
                channelProvider.deleteChannel(param.name);
                throw e;
            }
        },
        removeDynamicAgent: async (param: {
            contextId: number;
            name: string;
        }) => {
            const context = contextMap.get(param.contextId);
            await context.removeDynamicAgent(param.name);
            channelProvider.deleteChannel(param.name);
        },
        getSharedLocalHostPort: async (param: {
            contextId: number;
            agentName: string;
        }) => {
            const context = contextMap.get(param.contextId);
            return context.getSharedLocalHostPort(param.agentName);
        },
        indexes: async (param: { contextId: number; type: string }) => {
            const context = contextMap.get(param.contextId);
            return context.indexes(param.type as any);
        },
        storageRead: async (param: {
            contextId: number;
            session: boolean;
            storagePath: string;
            options?: StorageEncoding | undefined;
        }) => {
            const context = contextMap.get(param.contextId);
            const options = param.options;
            const storage = getStorage(param, context);
            if (options !== undefined) {
                return storage.read(param.storagePath, options);
            }
            return uint8ArrayToBase64(await storage.read(param.storagePath));
        },
        storageWrite: async (param: {
            contextId: number;
            session: boolean;
            storagePath: string;
            data: string;
            options?: StorageEncoding | undefined;
        }) => {
            const context = contextMap.get(param.contextId);
            return getStorage(param, context).write(
                param.storagePath,
                param.data,
                param.options,
            );
        },
        storageList: async (param: {
            contextId: number;
            session: boolean;
            storagePath: string;
            options?: StorageListOptions | undefined;
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
        tokenCacheDelete: async (param: {
            contextId: number;
            session: boolean;
        }) => {
            const context = contextMap.get(param.contextId);
            const storage = getStorage(param, context);
            return (await storage.getTokenCachePersistence()).delete();
        },
        popupQuestion: async (param: {
            contextId: number;
            message: string;
            choices?: string[] | undefined;
            defaultId?: number | undefined;
        }) => {
            const context = contextMap.get(param.contextId);
            return context.popupQuestion(
                param.message,
                param.choices,
                param.defaultId,
            );
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
            content: DisplayContent;
        }) => {
            actionContextMap
                .get(param.actionContextId)
                .actionIO.setDisplay(param.content);
        },
        appendDiagnosticData: (param: {
            actionContextId: number;
            data: any;
        }) => {
            actionContextMap
                .get(param.actionContextId)
                .actionIO.appendDiagnosticData(param.data);
        },
        appendDisplay: (param: {
            actionContextId: number;
            content: DisplayContent;
            mode: DisplayAppendMode;
        }) => {
            actionContextMap
                .get(param.actionContextId)
                .actionIO.appendDisplay(param.content, param.mode);
        },
        takeAction: (param: {
            actionContextId: number;
            action: ClientAction;
            data?: unknown;
        }) => {
            actionContextMap
                .get(param.actionContextId)
                .actionIO.takeAction(param.action, param.data);
        },
    };

    const rpc = createRpc<
        AgentInvokeFunctions,
        AgentCallFunctions,
        AgentContextInvokeFunctions,
        AgentContextCallFunctions
    >(channel, agentContextInvokeHandlers, agentContextCallHandlers);

    // The shim needs to implement all the APIs regardless whether the actual agent
    // has that API.  We remove remove it the one that is not necessary below.
    const agent: Required<AppAgent> = {
        initializeAgentContext(settings?: AppAgentInitSettings) {
            return rpc.invoke("initializeAgentContext", settings);
        },
        updateAgentContext(
            enable,
            context: SessionContext<ShimContext>,
            schemaName,
        ) {
            return rpc.invoke("updateAgentContext", {
                ...getContextParam(context),
                enable,
                schemaName,
            });
        },
        executeAction(
            action: TypeAgentAction,
            context: ActionContext<ShimContext>,
        ) {
            return withActionContextAsync(context, (contextParams) =>
                rpc.invoke("executeAction", {
                    ...contextParams,
                    action,
                }),
            );
        },
        validateWildcardMatch(
            action: AppAction,
            context: SessionContext<ShimContext>,
        ) {
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
        ): Promise<CommandDescriptors> {
            return rpc.invoke("getCommands", getContextParam(context));
        },
        getCommandCompletion(
            commands: string[],
            params: ParsedCommandParams<ParameterDefinitions>,
            names: string[],
            context: SessionContext<ShimContext>,
        ) {
            return rpc.invoke("getCommandCompletion", {
                ...getContextParam(context),
                commands,
                params,
                names,
            });
        },
        executeCommand(
            commands: string[],
            params: ParsedCommandParams<ParameterDefinitions> | undefined,
            context: ActionContext<ShimContext>,
        ) {
            return withActionContextAsync(context, (contextParams) =>
                rpc.invoke("executeCommand", {
                    ...contextParams,
                    commands,
                    params,
                }),
            );
        },
        resolveEntity(
            type: string,
            name: string,
            context: SessionContext<ShimContext>,
        ) {
            return rpc.invoke("resolveEntity", {
                ...getContextParam(context),
                type,
                name,
            });
        },
        getTemplateSchema(
            templateName,
            data,
            context: SessionContext<ShimContext>,
        ) {
            return rpc.invoke("getTemplateSchema", {
                ...getContextParam(context),
                templateName,
                data,
            });
        },

        getTemplateCompletion(
            templateName,
            data,
            propertyName,
            context: SessionContext<ShimContext>,
        ) {
            return rpc.invoke("getTemplateCompletion", {
                ...getContextParam(context),
                templateName,
                data,
                propertyName,
            });
        },
        getActionCompletion(
            partialAction,
            propertyName,
            context: SessionContext<ShimContext>,
        ) {
            return rpc.invoke("getActionCompletion", {
                ...getContextParam(context),
                partialAction,
                propertyName,
            });
        },
    };

    // Now pick out the one that is actually implemented
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
