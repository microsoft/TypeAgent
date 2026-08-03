// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Worker } from "node:worker_threads";
import { ScriptResult } from "../types.js";
import { BLOCKED_IDENTIFIERS } from "../validation/scriptValidator.js";

export interface ScriptExecutorConfig {
    apiParamName: string;
    defaultTimeout?: number;
    blockedIdentifiers?: Set<string>;
}

export interface ScriptExecutionOptions {
    timeout?: number;
}

interface WorkerCallMessage {
    type: "call";
    id: number;
    name: string;
    argsJson: string;
}

interface WorkerLogMessage {
    type: "log";
    level: string;
    argsJson: string;
}

interface WorkerResultMessage {
    type: "result";
    serializedResult: string;
}

type WorkerMessage = WorkerCallMessage | WorkerLogMessage | WorkerResultMessage;

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

export function createScriptExecutor(config: ScriptExecutorConfig): {
    execute(
        scriptSource: string,
        api: unknown,
        params: Record<string, unknown>,
        options?: ScriptExecutionOptions,
    ): Promise<ScriptResult>;
} {
    const identifiers = config.blockedIdentifiers ?? BLOCKED_IDENTIFIERS;
    const defaultTimeout = config.defaultTimeout ?? 180_000;
    const apiName = config.apiParamName;

    return {
        async execute(
            scriptSource: string,
            api: unknown,
            params: Record<string, unknown>,
            options?: ScriptExecutionOptions,
        ): Promise<ScriptResult> {
            const executionLog: unknown[][] = [];

            try {
                const timeout = options?.timeout ?? defaultTimeout;
                const serializedResult = await executeInWorker(
                    apiName,
                    scriptSource,
                    api,
                    params,
                    identifiers,
                    executionLog,
                    timeout,
                );
                const envelope = JSON.parse(serializedResult) as {
                    ok: boolean;
                    result?: unknown;
                    error?: string;
                };
                if (!envelope.ok) {
                    throw new Error(
                        envelope.error ?? "Generated script failed",
                    );
                }
                const result = envelope.result;

                if (
                    result &&
                    typeof result === "object" &&
                    "success" in result
                ) {
                    return result as ScriptResult;
                }

                return {
                    success: true,
                    message:
                        result !== undefined
                            ? String(result)
                            : "Script completed",
                    data: result,
                };
            } catch (error: unknown) {
                const message = errorMessage(error);
                return {
                    success: false,
                    error: message,
                    message: `Script execution failed: ${message}`,
                    runtimeError: true,
                };
            }
        },
    };
}

function executeInWorker(
    apiName: string,
    scriptSource: string,
    api: unknown,
    params: Record<string, unknown>,
    identifiers: Set<string>,
    executionLog: unknown[][],
    timeout: number,
): Promise<string> {
    if (!IDENTIFIER_PATTERN.test(apiName)) {
        throw new Error(`Invalid script API parameter name: ${apiName}`);
    }
    if (!isRecord(api)) {
        throw new Error("Script API must be an object");
    }

    const methods = new Map<string, (...args: unknown[]) => unknown>();
    const values: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(api)) {
        if (typeof value === "function") {
            methods.set(name, value as (...args: unknown[]) => unknown);
        } else {
            values[name] = value;
        }
    }

    const worker = new Worker(new URL("./scriptWorker.js", import.meta.url), {
        execArgv: [],
        workerData: {
            apiName,
            apiMethodNamesJson: serializeJson(
                [...methods.keys()],
                "API method names",
            ),
            apiValuesJson: serializeJson(values, "API values"),
            paramsJson: serializeJson(params, "script parameters"),
            identifiersJson: serializeJson(
                [...identifiers],
                "blocked identifiers",
            ),
            scriptSource,
            timeout,
        },
    });

    return new Promise<string>((resolve, reject) => {
        let settled = false;
        const timeoutHandle = setTimeout(
            () => finish(reject, new Error("Script execution timeout")),
            timeout,
        );

        function finish<T>(settle: (value: T) => void, value: T): void {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeoutHandle);
            void worker.terminate().catch(() => undefined);
            settle(value);
        }

        worker.on("message", (message: WorkerMessage) => {
            if (settled) {
                return;
            }
            switch (message.type) {
                case "call":
                    void handleWorkerCall(worker, methods, api, message);
                    break;
                case "log": {
                    const args = JSON.parse(message.argsJson) as unknown[];
                    executionLog.push(
                        message.level === "log"
                            ? args
                            : [message.level, ...args],
                    );
                    break;
                }
                case "result":
                    finish(resolve, message.serializedResult);
                    break;
            }
        });
        worker.on("error", (error) => finish(reject, error));
        worker.on("exit", (code) => {
            if (code !== 0) {
                finish(
                    reject,
                    new Error(`Script worker exited with code ${code}`),
                );
            }
        });
    });
}

async function handleWorkerCall(
    worker: Worker,
    methods: Map<string, (...args: unknown[]) => unknown>,
    api: Record<string, unknown>,
    message: WorkerCallMessage,
): Promise<void> {
    const method = methods.get(message.name);
    let responseJson: string;
    if (!method) {
        responseJson = serializeJson(
            {
                ok: false,
                error: `Unknown script API method: ${message.name}`,
            },
            "API error",
        );
    } else {
        try {
            const args = JSON.parse(message.argsJson) as unknown[];
            const value = await Reflect.apply(method, api, args);
            responseJson = serializeJson({ ok: true, value }, "API result");
        } catch (error) {
            responseJson = serializeJson(
                { ok: false, error: errorMessage(error) },
                "API error",
            );
        }
    }

    worker.postMessage({
        type: "callResult",
        id: message.id,
        responseJson,
    });
}

function serializeJson(value: unknown, description: string): string {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error(`${description} must be JSON-serializable`);
    }
    return serialized;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
