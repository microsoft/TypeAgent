// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

const debug = registerDebug("typeagent:rpc");
const debugError = registerDebug("typeagent:rpc:error");

import { RpcChannel } from "./common.js";

type RpcFuncType<
    N extends string,
    T extends Record<string, (...args: any) => any>,
> = {
    [K in keyof T as `${N}`]: <K extends string>(
        name: K,
        param: Parameters<T[K]>[0],
    ) => ReturnType<T[K]>;
};

type RpcReturn<
    InvokeTargetFunctions extends {
        [key: string]: (param: any) => Promise<unknown>;
    },
    CallTargetFunctions extends { [key: string]: (param: any) => void },
> = RpcFuncType<"invoke", InvokeTargetFunctions> &
    RpcFuncType<"send", CallTargetFunctions>;

export function createRpc<
    InvokeTargetFunctions extends {
        [key: string]: (param: any) => Promise<unknown>;
    },
    CallTargetFunctions extends { [key: string]: (param: any) => void },
    InvokeHandlers extends { [key: string]: (param: any) => Promise<unknown> },
    CallHandlers extends { [key: string]: (param: any) => void },
>(
    transport: RpcChannel,
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

    const cb = (message: any) => {
        debug("message", message);
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
                transport.send({
                    type: "invokeError",
                    callId: message.callId,
                    error: "No invoke handler",
                });
            } else {
                f(message.param).then(
                    (result) => {
                        transport.send({
                            type: "invokeResult",
                            callId: message.callId,
                            result,
                        });
                    },
                    (error) => {
                        transport.send({
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
    transport.on("message", cb);
    transport.once("disconnect", () => {
        debugError("disconnect");
        transport.off("message", cb);
        const errorFunc = () => {
            throw new Error("Agent process disconnected");
        };
        for (const r of pending.values()) {
            r.reject(new Error("Agent process disconnected"));
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
                transport.send!(message, (err) => {
                    if (err !== null) {
                        reject(err);
                    }
                });
                pending.set(message.callId, { resolve, reject });
            });
        },
        send: <P>(name: keyof CallTargetFunctions, param?: P) => {
            const message = {
                type: "call",
                callId: nextCallId++,
                name,
                param,
            };
            transport.send!(message);
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
