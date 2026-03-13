// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebFlowBrowserAPI } from "./webFlowBrowserApi.mjs";
import { WebFlowResult } from "./types.js";

export interface ScriptExecutionOptions {
    timeout: number;
}

const DEFAULT_OPTIONS: ScriptExecutionOptions = {
    timeout: 60000,
};

/**
 * Executes a webFlow script in a restricted environment.
 *
 * The script receives:
 * - `browser`: A frozen WebFlowBrowserAPI proxy
 * - `params`: Frozen parameter values
 * - `console`: A logging-only console stub
 *
 * The script has no access to window, document, fetch, require, etc.
 */
export async function executeWebFlowScript(
    scriptSource: string,
    browserApi: WebFlowBrowserAPI,
    params: Record<string, unknown>,
    options: ScriptExecutionOptions = DEFAULT_OPTIONS,
): Promise<WebFlowResult> {
    const executionLog: unknown[][] = [];

    const sandboxedBrowser = Object.freeze(browserApi);
    const sandboxedParams = Object.freeze({ ...params });
    const sandboxedConsole = Object.freeze({
        log: (...args: unknown[]) => executionLog.push(args),
        warn: (...args: unknown[]) => executionLog.push(["WARN", ...args]),
        error: (...args: unknown[]) => executionLog.push(["ERROR", ...args]),
    });

    const sandbox: Record<string, unknown> = {
        browser: sandboxedBrowser,
        params: sandboxedParams,
        console: sandboxedConsole,
    };

    try {
        const fn = new Function(
            ...Object.keys(sandbox),
            `"use strict"; return (${scriptSource})(browser, params);`,
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
            return result as WebFlowResult;
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
