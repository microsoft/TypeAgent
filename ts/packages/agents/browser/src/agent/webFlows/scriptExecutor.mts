// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebFlowBrowserAPI } from "./webFlowBrowserApi.mjs";
import { WebFlowResult } from "./types.js";
import { BLOCKED_IDENTIFIERS } from "./scriptValidator.mjs";

export interface ScriptExecutionOptions {
    timeout: number;
}

const DEFAULT_OPTIONS: ScriptExecutionOptions = {
    timeout: 180000,
};

// Globals that are explicitly shadowed with undefined in the Function scope,
// preventing scripts from accessing them even if the AST validator is bypassed.
// Reserved words cannot be used as parameter names in new Function().
// They are already blocked by the TS compiler validation and strict mode.
// Words that cannot be used as parameter names in new Function() with strict mode.
// "import" is a keyword; "eval" is restricted in strict mode.
const INVALID_PARAM_NAMES = new Set(["import", "eval"]);

const BLOCKED_GLOBALS_OVERRIDE: Record<string, undefined> = Object.fromEntries(
    [...BLOCKED_IDENTIFIERS]
        .filter((name) => !INVALID_PARAM_NAMES.has(name))
        .map((name) => [name, undefined]),
);

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
        ...BLOCKED_GLOBALS_OVERRIDE,
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
