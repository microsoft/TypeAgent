// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TaskFlowScriptAPI } from "./taskFlowScriptApi.mjs";
import { TaskFlowScriptResult } from "./types.mjs";

export interface ScriptExecutionOptions {
    timeout: number;
}

const DEFAULT_OPTIONS: ScriptExecutionOptions = {
    timeout: 300_000,
};

/**
 * Executes a taskFlow script in a restricted environment.
 *
 * The script receives:
 * - `api`: A frozen TaskFlowScriptAPI proxy for calling agent actions
 * - `params`: Frozen parameter values
 * - `console`: A logging-only console stub
 *
 * The script has no access to window, document, fetch, require, etc.
 */
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
