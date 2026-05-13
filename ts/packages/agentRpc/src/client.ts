// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AgentMessageKind,
    AgentThreadHandle,
    AppAgent,
    ActionContext,
    SessionContext,
    StorageListOptions,
    DisplayContent,
    DisplayAppendMode,
    CommandDescriptors,
    CompletionDirection,
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
import { getObjectProperty, uint8ArrayToBase64 } from "@typeagent/common-utils";
import { AgentInterfaceFunctionName } from "./server.js";
import { randomUUID } from "crypto";

/**
 * Race a promise against an AbortSignal. If the signal fires before the
 * promise settles, throw an AbortError immediately (the underlying work
 * continues in the background — the caller does not wait for it).
 */
function raceWithSignal<T>(
    promise: Promise<T>,
    signal: AbortSignal | undefined,
): Promise<T> {
    if (!signal) {
        return promise;
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = () =>
            reject(
                signal.reason ??
                    new DOMException(
                        "The operation was aborted.",
                        "AbortError",
                    ),
            );
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (v) => {
                signal.removeEventListener("abort", onAbort);
                resolve(v);
            },
            (e) => {
                signal.removeEventListener("abort", onAbort);
                reject(e);
            },
        );
    });
}

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
    // Tracks port registration handles returned by sessionContext.registerPort
    // so the out-of-process agent can release them via the regId we sent back.
    const registrationHandles = new Map<string, { release: () => void }>();
    // Reverse index: which regIds belong to which agent context. Lets us
    // release everything an out-of-process agent registered if it closes
    // its context without calling releasePort for each one (crash, bug,
    // forgetful agent). Without this, the agent could leak release closures
    // for the lifetime of the RPC client.
    const regIdsByContext = new Map<number, Set<string>>();
    function getContextParam(
        context: SessionContext<ShimContext>,
    ): ContextParams {
        return {
            contextId: contextMap.getId(context),
            hasInstanceStorage: context.instanceStorage !== undefined,
            hasSessionStorage: context.sessionStorage !== undefined,
            agentContextId: context.agentContext?.contextId,
            sessionContextId: context.sessionContextId,
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
                isFromReasoningLoop: actionContext.isFromReasoningLoop,
                ...getContextParam(actionContext.sessionContext),
            });
        } finally {
            actionContextMap.close(actionContext);
        }
    }
    async function withActionContextAsync<T>(
        actionContext: ActionContext<ShimContext>,
        fn: (contextParams: {
            actionContextId: number;
            isFromReasoningLoop: boolean;
        }) => Promise<T>,
    ) {
        try {
            return await fn({
                actionContextId: actionContextMap.getId(actionContext),
                isFromReasoningLoop: actionContext.isFromReasoningLoop,
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
                // If channel already exists, the agent was registered via a different path
                // (e.g., WebAgent via webTypeAgent.mts). Skip duplicate registration.
                if (e.message?.includes("already exists")) {
                    return;
                }
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
            channelProvider.deleteChannel(`agent:${param.name}`);
        },
        forceCleanupDynamicAgent: async (param: {
            contextId: number;
            name: string;
        }) => {
            const context = contextMap.get(param.contextId);
            await context.forceCleanupDynamicAgent(param.name);
            channelProvider.deleteChannel(`agent:${param.name}`);
        },
        getSharedLocalHostPort: async (param: {
            contextId: number;
            agentName: string;
        }) => {
            const context = contextMap.get(param.contextId);
            return context.getSharedLocalHostPort(param.agentName);
        },
        setLocalHostPort: async (param: {
            contextId: number;
            port: number;
        }) => {
            const context = contextMap.get(param.contextId);
            context.setLocalHostPort(param.port);
        },
        registerPort: async (param: {
            contextId: number;
            role: string;
            port: number;
        }) => {
            const context = contextMap.get(param.contextId);
            const handle = context.registerPort(param.role, param.port);
            const regId = randomUUID();
            registrationHandles.set(regId, handle);
            let regIds = regIdsByContext.get(param.contextId);
            if (regIds === undefined) {
                regIds = new Set<string>();
                regIdsByContext.set(param.contextId, regIds);
            }
            regIds.add(regId);
            return { regId };
        },
        releasePort: async (param: { regId: string; contextId?: number }) => {
            const handle = registrationHandles.get(param.regId);
            if (handle !== undefined) {
                registrationHandles.delete(param.regId);
                if (param.contextId !== undefined) {
                    regIdsByContext.get(param.contextId)?.delete(param.regId);
                }
                handle.release();
            }
        },
        indexes: async (param: { contextId: number; type: string }) => {
            const context = contextMap.get(param.contextId);
            return context.indexes(param.type as any);
        },
        reloadAgentSchema: async (param: { contextId: number }) => {
            const context = contextMap.get(param.contextId);
            return context.reloadAgentSchema();
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

    const agentThreadHandles = new Map<string, AgentThreadHandle>();
    const agentContextCallHandlers: AgentContextCallFunctions = {
        notify: (contextId: number, ...args) => {
            contextMap.get(contextId).notify(...args);
        },
        agentThreadBegin: (
            contextId: number,
            threadId: string,
            kind: AgentMessageKind,
        ) => {
            agentThreadHandles.set(
                threadId,
                contextMap.get(contextId).beginAgentThread(kind),
            );
        },
        agentThreadSetDisplay: (
            _contextId: number,
            threadId: string,
            content: DisplayContent,
        ) => {
            agentThreadHandles.get(threadId)?.setDisplay(content);
        },
        agentThreadAppendDisplay: (
            _contextId: number,
            threadId: string,
            content: DisplayContent,
            mode: DisplayAppendMode,
        ) => {
            agentThreadHandles.get(threadId)?.appendDisplay(content, mode);
        },
        agentThreadComplete: (_contextId: number, threadId: string) => {
            const handle = agentThreadHandles.get(threadId);
            if (handle === undefined) return;
            handle.complete();
            agentThreadHandles.delete(threadId);
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
            return withActionContextAsync(context, (contextParams) => {
                const signal = context.abortSignal;
                if (signal) {
                    const onAbort = () =>
                        rpc.send("cancelAction", {
                            actionContextId: contextParams.actionContextId,
                        });
                    signal.addEventListener("abort", onAbort, { once: true });
                    return raceWithSignal(
                        rpc.invoke("executeAction", {
                            ...contextParams,
                            action,
                        }),
                        signal,
                    ).finally(() => {
                        signal.removeEventListener("abort", onAbort);
                    });
                }
                return raceWithSignal(
                    rpc.invoke("executeAction", {
                        ...contextParams,
                        action,
                    }),
                    signal,
                );
            });
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
        startBackgroundTasks(context: SessionContext<ShimContext>) {
            return rpc.invoke("startBackgroundTasks", getContextParam(context));
        },
        stopBackgroundTasks(context: SessionContext<ShimContext>) {
            return rpc.invoke("stopBackgroundTasks", getContextParam(context));
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
            direction?: CompletionDirection,
        ) {
            return rpc.invoke("getCommandCompletion", {
                ...getContextParam(context),
                commands,
                params,
                names,
                ...(direction !== undefined ? { direction } : {}),
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
            context: SessionContext<ShimContext>,
            partialAction,
            propertyName,
            entityTypeName,
        ) {
            return rpc.invoke("getActionCompletion", {
                ...getContextParam(context),
                partialAction,
                propertyName,
                entityTypeName,
            });
        },
        handleChoice(
            choiceId: string,
            response: boolean | number[],
            context: ActionContext<ShimContext>,
        ) {
            return withActionContextAsync(context, (contextParams) =>
                rpc.invoke("handleChoice", {
                    ...contextParams,
                    choiceId,
                    response,
                }),
            );
        },
        getDynamicSchema(
            context: SessionContext<ShimContext>,
            schemaName: string,
        ) {
            return rpc.invoke("getDynamicSchema", {
                ...getContextParam(context),
                schemaName,
            });
        },
        getDynamicGrammar(
            context: SessionContext<ShimContext>,
            schemaName: string,
        ) {
            return rpc.invoke("getDynamicGrammar", {
                ...getContextParam(context),
                schemaName,
            });
        },
        checkReadiness(context: SessionContext<ShimContext>) {
            return rpc.invoke("checkReadiness", getContextParam(context));
        },
        setup(context: ActionContext<ShimContext>) {
            return withActionContextAsync(context, (contextParams) =>
                rpc.invoke("setup", { ...contextParams }),
            );
        },
    };

    // Now pick out the one that is actually implemented
    const result: AppAgent = Object.fromEntries(
        agentInterface.map((name) => [name, agent[name]]),
    );

    const invokeCloseAgentContext = result.closeAgentContext;
    result.closeAgentContext = async (context: SessionContext<ShimContext>) => {
        const result = await invokeCloseAgentContext?.(context);
        const contextId = contextMap.getId(context);
        // Backstop: release any port handles the out-of-process agent
        // failed to release explicitly (crash, bug, or just forgot). Mirrors
        // the dispatcher-side releaseAllForSession backstop so handles
        // can't outlive the context they're scoped to.
        const regIds = regIdsByContext.get(contextId);
        if (regIds !== undefined) {
            for (const regId of regIds) {
                const handle = registrationHandles.get(regId);
                if (handle !== undefined) {
                    registrationHandles.delete(regId);
                    try {
                        handle.release();
                    } catch {
                        // Best-effort cleanup; swallow.
                    }
                }
            }
            regIdsByContext.delete(contextId);
        }
        contextMap.close(context);
        // Clean up the options RPC channel once this agent context is closed.
        // Options are agent-scoped (created once per initializeAgentContext call)
        // so they can be released when the context is torn down.
        if (optionsRpc !== undefined) {
            channelProvider.deleteChannel(`options:${name}`);
            optionsRpc = undefined;
        }
        return result;
    };

    return result;
}
