// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess } from "child_process";
import registerDebug from "debug";

const debug = registerDebug("typeagent:process");
const debugError = registerDebug("typeagent:process:error");

export function setupInvoke<InvokeNames = string, CallNames = string>(
    process: ChildProcess | NodeJS.Process,
    invokeHandler?: (name: string, param: any) => Promise<any>,
    callHandler?: (name: string, param: any) => void,
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
            if (callHandler === undefined) {
                debugError("No call handler", message);
            } else {
                callHandler(message.name, message.param);
            }
            return;
        }
        if (isInvokeMessage(message)) {
            if (invokeHandler === undefined) {
                process.send!({
                    type: "invokeError",
                    callId: message.callId,
                    error: "No invoke handler",
                });
            } else {
                invokeHandler(message.name, message.param).then(
                    (result) => {
                        process.send!({
                            type: "invokeResult",
                            callId: message.callId,
                            result,
                        });
                    },
                    (error) => {
                        process.send!({
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
    process.on("message", cb);
    process.once("disconnect", () => {
        process.off("message", cb);
    });

    let nextCallId = 0;
    return {
        invoke: async function <T = void>(
            name: InvokeNames,
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
                process.send!(message);
            });
        },
        send: (name: CallNames, param?: any) => {
            const message = {
                type: "call",
                callId: nextCallId++,
                name,
                param,
            };
            process.send!(message);
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

export type CallMessage = {
    type: "call";
    callId: number;
    name: string;
    param: any;
};

export type InvokeMessage = {
    type: "invoke";
    callId: number;
    name: string;
    param: any;
};

export type InvokeResult<T = void> = {
    type: "invokeResult";
    callId: number;
    result: T;
};

export type InvokeError = {
    type: "invokeError";
    callId: number;
    error: string;
};
