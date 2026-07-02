// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

import { RpcChannel } from "./common.js";

type RpcFuncTypes<
    N extends string,
    T extends Record<string, (...args: any[]) => any>,
> = {
    [K in keyof T as `${N}`]: <K extends string>(
        name: K,
        ...args: Parameters<T[K]>
    ) => ReturnType<T[K]>;
};

type RpcInvokeFunction = (...args: any[]) => Promise<unknown>;
type RpcCallFunction = (...args: any[]) => void;
type RpcInvokeFunctions = Record<string, RpcInvokeFunction>;
type RpcCallFunctions = Record<string, RpcCallFunction>;
type RpcReturn<
    InvokeTargetFunctions extends RpcInvokeFunctions,
    CallTargetFunctions extends RpcCallFunctions,
> = RpcFuncTypes<"invoke", InvokeTargetFunctions> &
    RpcFuncTypes<"send", CallTargetFunctions> & {
        rebind(channel: RpcChannel): void;
    };

export type RpcOptions = {
    // When true, a disconnect rejects in-flight calls but leaves invoke/send
    // intact so the rpc can be reattached to a fresh channel via rebind().
    rebindable?: boolean;
};

export function createRpc<
    InvokeTargetFunctions extends RpcInvokeFunctions = {},
    CallTargetFunctions extends RpcCallFunctions = {},
    InvokeHandlers extends RpcInvokeFunctions = {},
    CallHandlers extends RpcCallFunctions = {},
>(
    name: string, // for debugging only.
    channel: RpcChannel,
    invokeHandlers?: InvokeHandlers,
    callHandlers?: CallHandlers,
    options?: RpcOptions,
): RpcReturn<InvokeTargetFunctions, CallTargetFunctions> {
    const debugIn = registerDebug(`typeagent:${name}:rpc:in`);
    const debugOut = registerDebug(`typeagent:${name}:rpc:out`);
    const debugError = registerDebug(`typeagent:${name}:rpc:error`);
    const pending = new Map<
        number,
        {
            resolve: (result: any) => void;
            reject: (error: any) => void;
        }
    >();

    const rebindable = options?.rebindable ?? false;
    let currentChannel: RpcChannel = channel;
    let connected = true;
    let bindGeneration = 0;
    const errorFunc = () => {
        throw new Error("Agent channel disconnected");
    };
    const rejectAllPending = (reason: string) => {
        for (const r of pending.values()) {
            r.reject(new Error(reason));
        }
        pending.clear();
    };

    const out = (
        message: RpcMessage,
        cbErr: (err: Error | null) => void = (e) => {},
    ) => {
        debugOut(message);
        currentChannel.send(message, cbErr);
    };
    const cb = (message: any) => {
        debugIn(message);
        if (isCallMessage(message)) {
            const f = callHandlers?.[message.name];

            if (f === undefined) {
                debugError("No call handler", message);
            } else {
                // Call handlers are fire-and-forget (no callId), so any
                // synchronous throw cannot be reported back to the caller.
                // Swallow it here to keep the RPC bus alive — otherwise a
                // single bad notify (e.g. cancelCommand after the remote
                // dispatcher channel disconnected) would surface as an
                // uncaught exception in the host process.
                try {
                    f(...message.args);
                } catch (e: any) {
                    debugError(
                        "Call handler threw",
                        message.name,
                        e?.message ?? e,
                    );
                }
            }
            return;
        }
        if (isInvokeMessage(message)) {
            const f = invokeHandlers?.[message.name];
            if (f === undefined) {
                out({
                    type: "invokeError",
                    callId: message.callId,
                    error: `No invoke handler ${message.name}`,
                });
            } else {
                f(...message.args).then(
                    (result) => {
                        out({
                            type: "invokeResult",
                            callId: message.callId,
                            result,
                        });
                    },
                    (error) => {
                        out({
                            type: "invokeError",
                            callId: message.callId,
                            error: error.message,
                            stack: debugError.enabled ? error.stack : undefined,
                        });
                    },
                );
            }
            return;
        }
        if (!isInvokeResult(message) && !isInvokeError(message)) {
            return;
        }
        const r = pending.get(message.callId);
        if (r === undefined) {
            debugError("Invalid callId", message);
            return;
        }
        pending.delete(message.callId);
        if (isInvokeResult(message)) {
            r.resolve(message.result);
        } else {
            debugError("Invoke error", message.stack);
            r.reject(new Error(message.error));
        }
    };
    const bindChannel = (newChannel: RpcChannel) => {
        currentChannel = newChannel;
        connected = true;
        const generation = ++bindGeneration;
        newChannel.on("message", cb);
        newChannel.once("disconnect", () => {
            // Ignore a superseded binding: a later rebind already moved on.
            if (generation !== bindGeneration) {
                return;
            }
            debugError("disconnect");
            newChannel.off("message", cb);
            connected = false;
            rejectAllPending("Agent channel disconnected");
            if (!rebindable) {
                rpc.invoke = errorFunc;
                rpc.send = errorFunc;
            }
        });
    };

    let nextCallId = 0;
    const rpc = {
        invoke: async function (
            name: keyof InvokeTargetFunctions,
            ...args: any[]
        ): Promise<any> {
            // Fail fast in a rebindable rpc's disconnected window (a poisoned
            // rpc never reaches here — invoke is replaced outright).
            if (!connected) {
                throw new Error("Agent channel disconnected");
            }
            const message: InvokeMessage = {
                type: "invoke",
                callId: nextCallId++,
                name: name as string,
                args,
            };

            return new Promise<any>((resolve, reject) => {
                out(message, (err) => {
                    if (err !== null) {
                        pending.delete(message.callId);
                        reject(err);
                    }
                });
                pending.set(message.callId, { resolve, reject });
            });
        },
        send: (name: keyof CallTargetFunctions, ...args: any[]) => {
            if (!connected) {
                throw new Error("Agent channel disconnected");
            }
            out(
                {
                    type: "call",
                    callId: nextCallId++,
                    name: name as string,
                    args,
                },
                (err) => {
                    if (err !== null) {
                        throw err;
                    }
                },
            );
        },
        rebind: (newChannel: RpcChannel) => {
            if (!rebindable) {
                throw new Error("rpc was not created as rebindable");
            }
            currentChannel.off("message", cb);
            rejectAllPending("Agent channel rebound");
            bindChannel(newChannel);
        },
    } as RpcReturn<InvokeTargetFunctions, CallTargetFunctions>;
    bindChannel(channel);
    return rpc;
}

function isCallMessage(message: any): message is CallMessage {
    return message.type === "call";
}

function isInvokeMessage(message: any): message is InvokeMessage {
    return message.type === "invoke";
}

function isInvokeResult(message: any): message is InvokeResult {
    return message.type === "invokeResult";
}

function isInvokeError(message: any): message is InvokeError {
    return message.type === "invokeError";
}

type CallMessage = {
    type: "call";
    callId: number; // Not necessary for call messages. included for tracing.
    name: string;
    args: any[];
};

type InvokeMessage = {
    type: "invoke";
    callId: number;
    name: string;
    args: any[];
};

type InvokeResult = {
    type: "invokeResult";
    callId: number;
    result: any;
};

type InvokeError = {
    type: "invokeError";
    callId: number;
    error: string;
    stack?: string; // Optional stack trace for debugging.
};

type RpcMessage = CallMessage | InvokeMessage | InvokeResult | InvokeError;
