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
import { getObjectProperty, uint8ArrayToBase64 } from "common-utils";
import { AgentInterfaceFunctionName } from "./server.js";

type ShimContext =
    | {
          contextId: number;
      }
    | undefined;

type ObjectMap<T = unknown> = {
    getId(obj: T): number;
    get(objId: number): T;
    close(obj: T): void;
};
function createObjectMap<T = unknown>(): ObjectMap<T> {
    let nextObjectId = 0;
    let objectIdMap = new Map<T, number>();
    let objectMap = new Map<number, T>();

    function getId(obj: T) {
        let objectId = objectIdMap.get(obj);
        if (objectId === undefined) {
            objectId = nextObjectId++;
            objectIdMap.set(obj, objectId);
            objectMap.set(objectId, obj);
        }
        return objectId;
    }
    function get(objId: number) {
        const context = objectMap.get(objId);
        if (context === undefined) {
            throw new Error(
                `Internal error: Invalid contextId ${objId}${objId < nextObjectId ? " used out of scope" : ""}`,
            );
        }
        return context;
    }

    function close(obj: T) {
        const objId = objectIdMap.get(obj);
        if (objId !== undefined) {
            objectIdMap.delete(obj);
            objectMap.delete(objId);
        }
    }
    return {
        getId,
        get,
        close,
    };
}

function getOptionsFunctions(options?: any): string[] | undefined {
    if (typeof options !== "object" || options === null) {
        return undefined;
    }
    if (options.__proto__ !== null && options.__proto__ !== Object.prototype) {
        // If the options is not a plain object, we cannot handle it
        throw new Error(
            "Options must be a plain object with no prototype or default prototype",
        );
    }
    const funcs: string[] = [];
    for (const [k, v] of Object.entries(options)) {
        if (typeof v === "function") {
            // Convert the function to a string to avoid circular references
            funcs.push(k);
            continue;
        }
        const valueFuncs = getOptionsFunctions(v);
        if (valueFuncs !== undefined) {
            for (const f of valueFuncs) {
                funcs.push(`${k}.${f}`);
            }
        }
    }
    return funcs.length > 0 ? funcs : undefined;
}

function createOptionsRpc(channelProvider: ChannelProvider, name: string) {
    const channel = channelProvider.createChannel(`options:${name}`);
    const optionsMap = createObjectMap();
    return {
        optionsMap,
        rpc: createRpc(name, channel, {
            callback: async (param: {
                id: number;
                name: string;
                args: any[];
            }) => {
                const options: any = optionsMap.get(param.id);
                let thisObject: any = undefined;
                let fn: (...args: any[]) => any;
                const name = param.name;
                if (name === "") {
                    fn = options;
                } else {
                    const names = param.name.split(".");
                    if (names.length === 1) {
                        thisObject = options;
                        fn = options[name];
                    } else {
                        const funcName = names.pop();
                        thisObject = getObjectProperty(options, name);
                        fn = thisObject[funcName!];
                    }
                }
                return fn.call(thisObject, ...param.args);
            },
        }),
    };
}

export async function createAgentRpcClient(
    name: string,
    channelProvider: ChannelProvider,
    agentInterface: AgentInterfaceFunctionName[],
) {
    const channel = channelProvider.createChannel(`agent:${name}`);
    const contextMap = createObjectMap<SessionContext<ShimContext>>();
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

    const actionContextMap = createObjectMap<ActionContext<ShimContext>>();
    let optionsRpc: ReturnType<typeof createOptionsRpc> | undefined;
    function getOptionsCallBack(options?: any) {
        const functions = getOptionsFunctions(options);
        if (functions === undefined) {
            return undefined;
        }
        if (optionsRpc === undefined) {
            optionsRpc = createOptionsRpc(channelProvider, name);
        }
        return {
            id: optionsRpc.optionsMap.getId(options),
            functions,
        };
    }
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
                        param.agentInterface,
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
        queueToggleTransientAgent: async (
            contextId: number,
            agentName: string,
            active: boolean,
        ) => {
            const context = actionContextMap.get(contextId);
            return context.queueToggleTransientAgent(agentName, active);
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
    >(name, channel, agentContextInvokeHandlers, agentContextCallHandlers);

    // The shim needs to implement all the APIs regardless whether the actual agent
    // has that API.  We remove remove it the one that is not necessary below.
    const agent: Required<AppAgent> = {
        initializeAgentContext(settings?: AppAgentInitSettings) {
            return rpc.invoke("initializeAgentContext", {
                settings,
                optionsCallBack: getOptionsCallBack(settings?.options),
            });
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
        // TODO: Clean up the associated options.
        const result = await invokeCloseAgentContext?.(context);
        contextMap.close(context);
        return result;
    };

    return result;
}
