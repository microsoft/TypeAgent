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
    DisplayContent,
    DisplayAppendMode,
    AppAgentEvent,
    ClientAction,
    AppAgentManifest,
    TypeAgentAction,
    AppAgentInitSettings,
} from "@typeagent/agent-sdk";

import {
    ActionContextParams,
    AgentCallFunctions,
    AgentContextCallFunctions,
    AgentContextInvokeFunctions,
    AgentInvokeFunctions,
    ContextParams,
    OptionsFunctionCallBack,
} from "./types.js";
import { createRpc } from "./rpc.js";
import { ChannelProvider, RpcChannel } from "./common.js";
import {
    base64ToUint8Array,
    uint8ArrayToBase64,
    createLimiter,
    setObjectProperty,
} from "common-utils";

function createOptionsRpc(channelProvider: ChannelProvider, name: string) {
    const optionsChannel: RpcChannel = channelProvider.createChannel(
        `options:${name}`,
    );
    return createRpc<OptionsFunctionCallBack>(name, optionsChannel);
}

function populateOptionsFunctions(
    rpc: ReturnType<typeof createOptionsRpc>,
    options: any,
    optionsCallback: {
        id: number;
        functions: string[];
    },
) {
    const { id, functions } = optionsCallback;
    const obj = { options };
    for (const name of functions) {
        setObjectProperty(obj, "options", name, (...args: any[]) => {
            return rpc.invoke("callback", { name, id, args });
        });
    }
}

export function createAgentRpcServer(
    name: string,
    agent: AppAgent,
    channelProvider: ChannelProvider,
) {
    const channelName = `agent:${name}`;
    const channel = channelProvider.createChannel(channelName);
    let optionsRpc: ReturnType<typeof createOptionsRpc> | undefined;

    const agentInvokeHandlers: AgentInvokeFunctions = {
        async initializeAgentContext(param: {
            settings?: AppAgentInitSettings | undefined;
            optionsCallBack?:
                | {
                      id: number;
                      functions: string[];
                  }
                | undefined;
        }): Promise<unknown> {
            if (agent.initializeAgentContext === undefined) {
                throw new Error("Invalid invocation of initializeAgentContext");
            }
            const { settings, optionsCallBack } = param;
            if (optionsCallBack !== undefined) {
                if (
                    settings === undefined ||
                    typeof settings.options !== "object" ||
                    settings.options === null
                ) {
                    throw new Error(
                        "Internal Error: options must be an object or null with optionsCallBack",
                    );
                }
                if (optionsRpc === undefined) {
                    optionsRpc = createOptionsRpc(channelProvider, name);
                }
                populateOptionsFunctions(
                    optionsRpc,
                    settings.options,
                    optionsCallBack,
                );
            }
            const agentContext = await agent.initializeAgentContext?.(settings);
            return {
                contextId: registerAgentContext(agentContext),
            };
        },
        async updateAgentContext(
            param: Partial<ContextParams> & {
                enable: boolean;
                schemaName: string;
            },
        ): Promise<any> {
            if (agent.updateAgentContext === undefined) {
                throw new Error(`Invalid invocation of updateAgentContext`);
            }
            return agent.updateAgentContext(
                param.enable,
                getSessionContextShim(param),
                param.schemaName,
            );
        },
        async executeAction(
            param: Partial<ActionContextParams> & {
                action: TypeAgentAction;
            },
        ): Promise<any> {
            if (agent.executeAction === undefined) {
                throw new Error("Invalid invocation of executeAction");
            }
            return agent.executeAction(
                param.action,
                getActionContextShim(param),
            );
        },
        async validateWildcardMatch(param): Promise<any> {
            if (agent.validateWildcardMatch === undefined) {
                throw new Error("Invalid invocation of validateWildcardMatch");
            }
            return agent.validateWildcardMatch(
                param.action,
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
        async resolveEntity(param) {
            if (agent.resolveEntity === undefined) {
                throw new Error("Invalid invocation of resolveEntity");
            }
            return agent.resolveEntity(
                param.type,
                param.name,
                getSessionContextShim(param),
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

    const rpc = createRpc<
        AgentContextInvokeFunctions,
        AgentContextCallFunctions,
        AgentInvokeFunctions,
        AgentCallFunctions
    >(name, channel, agentInvokeHandlers, agentCallHandlers);

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
            delete: async (): Promise<boolean> => {
                return rpc.invoke("tokenCacheDelete", {
                    contextId,
                    session,
                });
            },
        };

        async function readStorage(
            storagePath: string,
            options: StorageEncoding,
        ): Promise<string>;
        async function readStorage(storagePath: string): Promise<Uint8Array>;
        async function readStorage(
            storagePath: string,
            options?: StorageEncoding,
        ): Promise<string | Uint8Array> {
            if (options === undefined) {
                return base64ToUint8Array(
                    await rpc.invoke("storageRead", {
                        contextId,
                        session,
                        storagePath,
                        options: "base64",
                    }),
                );
            }
            return rpc.invoke("storageRead", {
                contextId,
                session,
                storagePath,
                options,
            });
        }
        return {
            read: readStorage,
            write: (
                storagePath: string,
                data: string | Uint8Array,
                options?: StorageEncoding,
            ): Promise<void> => {
                let dataToSend: string;
                let optionsToSend: StorageEncoding | undefined;
                if (typeof data === "string") {
                    dataToSend = data;
                    optionsToSend = options;
                } else {
                    dataToSend = uint8ArrayToBase64(data);
                    optionsToSend = "base64";
                }

                return rpc.invoke("storageWrite", {
                    contextId,
                    session,
                    storagePath,
                    data: dataToSend,
                    options: optionsToSend,
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
        hasInstanceStorage: boolean,
        hasSessionStorage: boolean,
        context: any,
    ): SessionContext<any> {
        const dynamicAgentRpcServer = new Map<string, () => void>();
        const dynamicAgentLock = createLimiter(1);
        return {
            agentContext: context,
            sessionStorage: hasSessionStorage
                ? getStorage(contextId, true)
                : undefined,
            instanceStorage: hasInstanceStorage
                ? getStorage(contextId, false)
                : undefined,
            notify: (event: AppAgentEvent, message: string): void => {
                rpc.send("notify", {
                    contextId,
                    event,
                    message,
                });
            },
            popupQuestion: async (
                message: string,
                choices?: string[],
                defaultId?: number,
            ): Promise<number> => {
                return rpc.invoke("popupQuestion", {
                    contextId,
                    message,
                    choices,
                    defaultId,
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
            getSharedLocalHostPort: async (agentName: string) => {
                return rpc.invoke("getSharedLocalHostPort", {
                    contextId,
                    agentName,
                });
            },
            addDynamicAgent: async (
                name: string,
                manifest: AppAgentManifest,
                agent: AppAgent,
            ) =>
                // State for dynamic agent needs to be serialized.
                dynamicAgentLock(async () => {
                    if (dynamicAgentRpcServer.has(name)) {
                        throw new Error(`Duplicate agent name: ${name}`);
                    }

                    const { closeFn, agentInterface } = createAgentRpcServer(
                        name,
                        agent,
                        channelProvider,
                    );
                    // Trigger the addDynamicAgent on the client side
                    const p = rpc.invoke("addDynamicAgent", {
                        contextId,
                        name,
                        manifest,
                        agentInterface,
                    });

                    try {
                        // Wait for dispatcher to finish adding the agent
                        await p;
                        dynamicAgentRpcServer.set(name, closeFn);
                    } catch (e) {
                        closeFn();
                        throw e;
                    }
                }),
            removeDynamicAgent: async (name: string) =>
                dynamicAgentLock(async () => {
                    const closeFn = dynamicAgentRpcServer.get(name);
                    if (closeFn === undefined) {
                        throw new Error(`Invalid agent name: ${name}`);
                    }

                    try {
                        dynamicAgentRpcServer.delete(name);

                        await rpc.invoke("removeDynamicAgent", {
                            contextId,
                            name,
                        });
                    } finally {
                        closeFn();
                    }
                }),
            indexes: async (type: string): Promise<any[]> => {
                return await rpc.invoke("indexes", {
                    contextId,
                    type,
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

    function getSessionContextShim(
        param: Partial<ContextParams>,
    ): SessionContext {
        const {
            contextId,
            hasInstanceStorage,
            hasSessionStorage,
            agentContextId,
        } = param;
        if (contextId === undefined) {
            throw new Error("Invalid context param: missing contextId");
        }
        if (hasInstanceStorage === undefined) {
            throw new Error(
                "Invalid context param: missing hasInstanceStorage",
            );
        }
        if (hasSessionStorage === undefined) {
            throw new Error("Invalid context param: missing hasSessionStorage");
        }

        const agentContext =
            agentContextId !== undefined
                ? getAgentContext(agentContextId)
                : undefined;

        return createSessionContextShim(
            contextId,
            hasInstanceStorage,
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
        const sessionContext = getSessionContextShim(param);
        const actionIO: ActionIO = {
            setDisplay(content: DisplayContent): void {
                rpc.send("setDisplay", {
                    actionContextId,
                    content,
                });
            },
            appendDiagnosticData(data): void {
                rpc.send("appendDiagnosticData", { actionContextId, data });
            },
            appendDisplay(
                content: DisplayContent,
                mode: DisplayAppendMode,
            ): void {
                rpc.send("appendDisplay", {
                    actionContextId,
                    content,
                    mode,
                });
            },
            takeAction(action: ClientAction, data?: unknown) {
                rpc.send("takeAction", {
                    actionContextId,
                    action,
                    data,
                });
            },
        };
        return {
            // streamingContext is only used by the agent, so it is not mirrored back to the dispatcher.
            streamingContext: undefined,
            activityContext: param.activityContext,
            get sessionContext() {
                return sessionContext;
            },
            get actionIO() {
                return actionIO;
            },
            queueToggleTransientAgent(agentName: string, active: boolean) {
                return rpc.invoke(
                    "queueToggleTransientAgent",
                    actionContextId,
                    agentName,
                    active,
                );
            },
        };
    }

    const allAgentInterface = Object.keys(agentInvokeHandlers).concat(
        Object.keys(agentCallHandlers),
    );

    const agentInterface = allAgentInterface.filter(
        (a: string) =>
            (agent as any)[a] !== undefined ||
            (a === "closeAgentContext" &&
                agent.initializeAgentContext !== undefined),
    ) as AgentInterfaceFunctionName[];

    return {
        agentInterface,
        closeFn: () => {
            channelProvider.deleteChannel(channelName);
        },
    };
}

export type AgentInterfaceFunctionName =
    | keyof AgentInvokeFunctions
    | keyof AgentCallFunctions;
