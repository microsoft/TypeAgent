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
    RpcFuncTypes<"send", CallTargetFunctions>;

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

    const out = (message: any, cbErr?: (err: Error | null) => void) => {
        debugOut(message);
        channel.send(message, cbErr);
    };
    const cb = (message: any) => {
        debugIn(message);
        if (isCallMessage(message)) {
            const f = callHandlers?.[message.name];

            if (f === undefined) {
                debugError("No call handler", message);
            } else {
                f(...message.args);
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
            r.reject(new Error(message.error));
        }
    };
    channel.on("message", cb);
    channel.once("disconnect", () => {
        debugError("disconnect");
        channel.off("message", cb);
        const errorFunc = () => {
            throw new Error("Agent channel disconnected");
        };
        for (const r of pending.values()) {
            r.reject(new Error("Agent channel disconnected"));
        }
        pending.clear();
        rpc.invoke = errorFunc;
        rpc.send = errorFunc;
    });

    let nextCallId = 0;
    const rpc = {
        invoke: async function (
            name: keyof InvokeTargetFunctions,
            ...args: any[]
        ): Promise<any> {
            const message = {
                type: "invoke",
                callId: nextCallId++,
                name,
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
            out({
                type: "call",
                callId: nextCallId++,
                name,
                args,
            });
        },
    } as RpcReturn<InvokeTargetFunctions, CallTargetFunctions>;
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

type InvokeResult<T = void> = {
    type: "invokeResult";
    callId: number;
    result: T;
};

type InvokeError = {
    type: "invokeError";
    callId: number;
    error: string;
};
