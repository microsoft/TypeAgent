// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TaskFlowScriptAPI } from "./taskFlowScriptApi.mjs";
import { TaskFlowScriptResult } from "./types.mjs";
import { BLOCKED_IDENTIFIERS } from "./taskFlowScriptValidator.mjs";

export interface ScriptExecutionOptions {
    timeout: number;
}

const DEFAULT_OPTIONS: ScriptExecutionOptions = {
    timeout: 300_000,
};

const INVALID_PARAM_NAMES = new Set(["import", "eval"]);

const BLOCKED_GLOBALS_OVERRIDE: Record<string, undefined> = Object.fromEntries(
    [...BLOCKED_IDENTIFIERS]
        .filter((name) => !INVALID_PARAM_NAMES.has(name))
        .map((name) => [name, undefined]),
);

export async function executeTaskFlowScript(
    scriptSource: string,
    api: TaskFlowScriptAPI,
    params: Record<string, unknown>,
    options: ScriptExecutionOptions = DEFAULT_OPTIONS,
): Promise<TaskFlowScriptResult> {
    const executionLog: unknown[][] = [];

    const sandboxedApi = Object.freeze(api);
    const sandboxedParams = Object.freeze({ ...params });
    const sandboxedConsole = Object.freeze({
        log: (...args: unknown[]) => executionLog.push(args),
        warn: (...args: unknown[]) => executionLog.push(["WARN", ...args]),
        error: (...args: unknown[]) => executionLog.push(["ERROR", ...args]),
    });

    const sandbox: Record<string, unknown> = {
        api: sandboxedApi,
        params: sandboxedParams,
        console: sandboxedConsole,
        ...BLOCKED_GLOBALS_OVERRIDE,
    };

    try {
        const fn = new Function(
            ...Object.keys(sandbox),
            `"use strict"; return (${scriptSource})(api, params);`,
        );

        const resultPromise = fn(...Object.values(sandbox));

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
                () => reject(new Error("Script execution timeout")),
                options.timeout,
            );
        });

        const result = await Promise.race([resultPromise, timeoutPromise]);

        if (result && typeof result === "object" && "success" in result) {
            return result as TaskFlowScriptResult;
        }

        return {
            success: true,
            message: result !== undefined ? String(result) : "Script completed",
            data: result,
        };
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: errorMessage,
            message: `Script execution failed: ${errorMessage}`,
        };
    }
}
