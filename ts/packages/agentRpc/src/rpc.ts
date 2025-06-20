// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

const debugIn = registerDebug("typeagent:rpc:in");
const debugOut = registerDebug("typeagent:rpc:out");
const debugError = registerDebug("typeagent:rpc:error");

import { RpcChannel } from "./common.js";

type RpcFuncTypes<
    N extends string,
    T extends Record<string, (...args: any) => any>,
> = {
    [K in keyof T as `${N}`]: <K extends string>(
        name: K,
        param: Parameters<T[K]>[0],
    ) => ReturnType<T[K]>;
};

type RpcInvokeFunction = (param: any) => Promise<unknown>;
type RpcCallFunction = (param: any) => void;
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
    channel: RpcChannel,
    invokeHandlers?: InvokeHandlers,
    callHandlers?: CallHandlers,
): RpcReturn<InvokeTargetFunctions, CallTargetFunctions> {
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
                f(message.param);
            }
            return;
        }
        if (isInvokeMessage(message)) {
            const f = invokeHandlers?.[message.name];
            if (f === undefined) {
                out({
                    type: "invokeError",
                    callId: message.callId,
                    error: "No invoke handler",
                });
            } else {
                f(message.param).then(
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
        invoke: async function <P, T>(
            name: keyof InvokeTargetFunctions,
            param: P,
        ): Promise<T> {
            const message = {
                type: "invoke",
                callId: nextCallId++,
                name,
                param,
            };

            return new Promise<T>((resolve, reject) => {
                out(message, (err) => {
                    if (err !== null) {
                        reject(err);
                    }
                });
                pending.set(message.callId, { resolve, reject });
            });
        },
        send: <P>(name: keyof CallTargetFunctions, param?: P) => {
            out({
                type: "call",
                callId: nextCallId++,
                name,
                param,
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
    callId: number;
    name: string;
    param: any;
};

type InvokeMessage = {
    type: "invoke";
    callId: number;
    name: string;
    param: any;
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
