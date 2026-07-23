// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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

// Reserved words cannot be used as parameter names in new Function().
// They are already blocked by the TS compiler validation and strict mode.
const INVALID_PARAM_NAMES = new Set(["import", "eval"]);

function buildBlockedGlobalsOverride(
    identifiers: Set<string>,
): Record<string, undefined> {
    return Object.fromEntries(
        [...identifiers]
            .filter((name) => !INVALID_PARAM_NAMES.has(name))
            .map((name) => [name, undefined]),
    );
}

export function createScriptExecutor(config: ScriptExecutorConfig): {
    execute(
        scriptSource: string,
        api: unknown,
        params: Record<string, unknown>,
        options?: ScriptExecutionOptions,
    ): Promise<ScriptResult>;
} {
    const identifiers = config.blockedIdentifiers ?? BLOCKED_IDENTIFIERS;
    const blockedGlobalsOverride = buildBlockedGlobalsOverride(identifiers);
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
            let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

            const sandboxedApi = Object.freeze(api);
            const sandboxedParams = Object.freeze({ ...params });
            const sandboxedConsole = Object.freeze({
                log: (...args: unknown[]) => executionLog.push(args),
                warn: (...args: unknown[]) =>
                    executionLog.push(["WARN", ...args]),
                error: (...args: unknown[]) =>
                    executionLog.push(["ERROR", ...args]),
            });

            const sandbox: Record<string, unknown> = {
                [apiName]: sandboxedApi,
                params: sandboxedParams,
                console: sandboxedConsole,
                ...blockedGlobalsOverride,
            };

            try {
                const fn = new Function(
                    ...Object.keys(sandbox),
                    `"use strict"; return (${scriptSource})(${apiName}, params);`,
                );

                const resultPromise = fn(...Object.values(sandbox));

                const timeout = options?.timeout ?? defaultTimeout;
                const timeoutPromise = new Promise<never>((_, reject) => {
                    timeoutHandle = setTimeout(
                        () => reject(new Error("Script execution timeout")),
                        timeout,
                    );
                });

                const result = await Promise.race([
                    resultPromise,
                    timeoutPromise,
                ]);

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
                const errorMessage =
                    error instanceof Error ? error.message : String(error);
                return {
                    success: false,
                    error: errorMessage,
                    message: `Script execution failed: ${errorMessage}`,
                };
            } finally {
                if (timeoutHandle !== undefined) {
                    clearTimeout(timeoutHandle);
                }
            }
        },
    };
}
