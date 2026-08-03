// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createContext, Script, type Context } from "node:vm";
import { parentPort, workerData } from "node:worker_threads";

interface ScriptWorkerData {
    apiName: string;
    apiMethodNamesJson: string;
    apiValuesJson: string;
    paramsJson: string;
    identifiersJson: string;
    scriptSource: string;
    timeout: number;
}

interface CallResultMessage {
    type: "callResult";
    id: number;
    responseJson: string;
}

const INTERNAL_BINDINGS = [
    "__typeAgentApiKeys",
    "__typeAgentApiValues",
    "__typeAgentParams",
    "__typeAgentCall",
    "__typeAgentLog",
] as const;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const port = requireParentPort();
const data = workerData as ScriptWorkerData;
const pendingCalls = new Map<number, (responseJson: string) => void>();
let nextCallId = 0;

port.on("message", (message: CallResultMessage) => {
    if (message.type !== "callResult") {
        return;
    }
    const resolve = pendingCalls.get(message.id);
    if (resolve) {
        pendingCalls.delete(message.id);
        resolve(message.responseJson);
    }
});

function callHost(name: string, argsJson: string): Promise<string> {
    const id = nextCallId++;
    return new Promise<string>((resolve) => {
        pendingCalls.set(id, resolve);
        port.postMessage({ type: "call", id, name, argsJson });
    });
}

function logHost(level: string, argsJson: string): void {
    port.postMessage({ type: "log", level, argsJson });
}

function createSandboxContext(): Context {
    const sandbox = {
        __typeAgentApiKeys: data.apiMethodNamesJson,
        __typeAgentApiValues: data.apiValuesJson,
        __typeAgentParams: data.paramsJson,
        __typeAgentCall: callHost,
        __typeAgentLog: logHost,
    };
    const context = createContext(sandbox, {
        codeGeneration: { strings: false, wasm: false },
    });
    const bootstrap = new Script(`
        (() => {
            "use strict";
            const callHost = __typeAgentCall;
            const logHost = __typeAgentLog;
            const api = Object.create(null);
            for (const name of JSON.parse(__typeAgentApiKeys)) {
                Object.defineProperty(api, name, {
                    configurable: false,
                    enumerable: true,
                    writable: false,
                    value: (...args) => {
                        const pending = (async () => {
                            const response = JSON.parse(
                                await callHost(name, JSON.stringify(args)),
                            );
                            if (!response.ok) {
                                throw new Error(response.error);
                            }
                            return response.value;
                        })();
                        pending.catch(() => undefined);
                        return pending;
                    },
                });
            }
            for (const [name, value] of Object.entries(
                JSON.parse(__typeAgentApiValues),
            )) {
                Object.defineProperty(api, name, {
                    configurable: false,
                    enumerable: true,
                    writable: false,
                    value,
                });
            }
            globalThis[${JSON.stringify(data.apiName)}] = Object.freeze(api);
            globalThis.params = Object.freeze(JSON.parse(__typeAgentParams));
            globalThis.console = Object.freeze({
                log: (...args) => logHost("log", JSON.stringify(args)),
                warn: (...args) => logHost("WARN", JSON.stringify(args)),
                error: (...args) => logHost("ERROR", JSON.stringify(args)),
            });
            ${INTERNAL_BINDINGS.map((name) => `delete globalThis.${name};`).join("\n")}
        })();
    `);
    bootstrap.runInContext(context);
    const identifiers = JSON.parse(data.identifiersJson) as string[];
    for (const identifier of identifiers) {
        if (IDENTIFIER_PATTERN.test(identifier)) {
            (context as Record<string, unknown>)[identifier] = undefined;
        }
    }
    return context;
}

async function execute(): Promise<void> {
    try {
        const context = createSandboxContext();
        const execution = new Script(`
            "use strict";
            Promise.resolve((${data.scriptSource})(${data.apiName}, params)).then(
                (result) => JSON.stringify({ ok: true, result }),
                (error) => JSON.stringify({
                    ok: false,
                    error: error instanceof Error
                        ? error.message
                        : String(error),
                }),
            );
        `);
        const serializedResult = (await execution.runInContext(context, {
            timeout: data.timeout,
        })) as string;
        port.postMessage({ type: "result", serializedResult });
    } catch (error) {
        port.postMessage({
            type: "result",
            serializedResult: JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            }),
        });
    }
}

void execute();

function requireParentPort(): NonNullable<typeof parentPort> {
    if (!parentPort) {
        throw new Error("Script worker requires a parent port");
    }
    return parentPort;
}
