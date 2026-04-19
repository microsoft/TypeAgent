// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebFlowBrowserAPI } from "./webFlowBrowserApi.mjs";
import {
    executeWebFlowScript,
    ScriptExecutionOptions,
} from "./scriptExecutor.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:webflows:testrunner");

export interface TestRunResult {
    success: boolean;
    message: string;
    executionTime: number;
    error?: string;
    data?: unknown;
}

export interface TestRunOptions {
    timeout?: number;
    retryOnFailure?: boolean;
    maxRetries?: number;
}

const DEFAULT_TEST_OPTIONS: Required<TestRunOptions> = {
    timeout: 60000,
    retryOnFailure: false,
    maxRetries: 1,
};

/**
 * Tests a generated WebFlow script by executing it against the current browser state.
 * Used to verify that generated scripts work before saving them.
 */
export async function testGeneratedScript(
    script: string,
    browserApi: WebFlowBrowserAPI,
    testParams: Record<string, unknown> = {},
    options: TestRunOptions = {},
): Promise<TestRunResult> {
    const fullOptions = { ...DEFAULT_TEST_OPTIONS, ...options };
    const startTime = Date.now();

    const executionOptions: ScriptExecutionOptions = {
        timeout: fullOptions.timeout,
    };

    let lastError: string | undefined;
    let attempts = 0;

    while (
        attempts < (fullOptions.retryOnFailure ? fullOptions.maxRetries : 1)
    ) {
        attempts++;
        debug(
            `Test attempt ${attempts}/${fullOptions.maxRetries} with params:`,
            testParams,
        );

        try {
            const result = await executeWebFlowScript(
                script,
                browserApi,
                testParams,
                executionOptions,
            );

            if (result.success) {
                debug("Test passed:", result.message);
                return {
                    success: true,
                    message: result.message || "Test passed",
                    executionTime: Date.now() - startTime,
                    data: result.data,
                };
            }

            lastError = result.error || result.message || "Unknown error";
            debug(`Test attempt ${attempts} failed:`, lastError);

            if (!fullOptions.retryOnFailure) {
                break;
            }
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            debug(`Test attempt ${attempts} threw error:`, lastError);

            if (!fullOptions.retryOnFailure) {
                break;
            }
        }
    }

    const failureResult: TestRunResult = {
        success: false,
        message: "Test execution failed",
        executionTime: Date.now() - startTime,
    };
    if (lastError !== undefined) {
        failureResult.error = lastError;
    }
    return failureResult;
}

/**
 * Validates that a script can be parsed and has the expected structure.
 * Does not execute the script - use testGeneratedScript for execution testing.
 */
export function validateScriptStructure(script: string): {
    valid: boolean;
    error?: string;
} {
    try {
        // Check that script is a valid function expression
        new Function(`"use strict"; return (${script})`);
        return { valid: true };
    } catch (error) {
        return {
            valid: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
