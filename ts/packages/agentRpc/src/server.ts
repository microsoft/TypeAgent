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
import {
    base64ToUint8Array,
    uint8ArrayToBase64,
    createLimiter,
} from "common-utils";

export function createAgentRpcServer(
    name: string,
    agent: AppAgent,
    channelProvider: ChannelProvider,
) {
    const channel = channelProvider.createChannel(name);
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
    >(channel, agentInvokeHandlers, agentCallHandlers);

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
                // Binary read turns to base64 read for marshalling
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
                if (typeof data !== "string") {
                    // Binary write turns to base64 write for marshalling
                    return rpc.invoke("storageWrite", {
                        contextId,
                        session,
                        storagePath,
                        data: uint8ArrayToBase64(data),
                        options: "base64",
                    });
                }

                return rpc.invoke("storageWrite", {
                    contextId,
                    session,
                    storagePath,
                    data,
                    options,
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

                    // Trigger the addDynamicAgent on the client side
                    const p = rpc.invoke("addDynamicAgent", {
                        contextId,
                        name,
                        manifest,
                    });

                    // Create the agent RPC server to send the "initialized" message
                    const closeFn = createAgentRpcServer(
                        name,
                        agent,
                        channelProvider,
                    );

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

    channel.send({
        type: "initialized",
        agentInterface: allAgentInterface.filter(
            (a: string) =>
                (agent as any)[a] !== undefined ||
                (a === "closeAgentContext" &&
                    agent.initializeAgentContext !== undefined),
        ),
    });

    return () => {
        channelProvider.deleteChannel(name);
    };
}
