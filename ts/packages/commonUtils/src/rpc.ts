// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

const debug = registerDebug("typeagent:rpc");
const debugError = registerDebug("typeagent:rpc:error");

// Compatible with ChildProcess | NodeJS.Process
export type Transport<T = any> = {
    on(event: "message", cb: (message: Partial<T>) => void): void;
    on(event: "disconnect", cb: () => void): void;
    once(event: "message", cb: (message: Partial<T>) => void): void;
    once(event: "disconnect", cb: () => void): void;
    off(event: "message", cb: (message: Partial<T>) => void): void;
    off(event: "disconnect", cb: () => void): void;
    send(message: T): void;
};

export function createRpc<
    InvokeTargetFunctions extends {
        [key: string]: (param: any) => Promise<any>;
    },
    CallTargetFunctions extends { [key: string]: (param: any) => void },
    InvokeHandlers extends { [key: string]: (param: any) => Promise<any> },
    CallHandlers extends { [key: string]: (param: any) => void },
>(
    transport: Transport,
    invokeHandlers?: InvokeHandlers,
    callHandlers?: CallHandlers,
) {
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
        transport.off("message", cb);
    });

    let nextCallId = 0;
    return {
        invoke: async function <T = void>(
            name: keyof InvokeTargetFunctions,
            param?: any,
        ): Promise<T> {
            const message = {
                type: "invoke",
                callId: nextCallId++,
                name,
                param,
            };
            return new Promise<T>((resolve, reject) => {
                pending.set(message.callId, { resolve, reject });
                transport.send!(message);
            });
        },
        send: (name: keyof CallTargetFunctions, param?: any) => {
            const message = {
                type: "call",
                callId: nextCallId++,
                name,
                param,
            };
            transport.send!(message);
        },
    };
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
