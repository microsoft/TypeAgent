// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    EvaluationResult,
    PipelineTrace,
    TestUtterance,
} from "../types.mjs";

export function evaluateExecution(
    utterance: TestUtterance,
    trace: PipelineTrace,
    commandResult: unknown,
): EvaluationResult[] {
    const results: EvaluationResult[] = [];
    const exec = utterance.expected.execution;
    if (!exec) return results;

    const output = extractOutput(commandResult, trace);
    const hasError = extractHasError(commandResult, trace);

    // Check success/failure
    results.push({
        passed: exec.shouldSucceed ? !hasError : hasError,
        component: "execution",
        expected: exec.shouldSucceed ? "success" : "failure",
        actual: hasError ? "failure" : "success",
        message:
            exec.shouldSucceed === hasError
                ? `Expected ${exec.shouldSucceed ? "success" : "failure"} but got ${hasError ? "failure" : "success"}`
                : undefined,
    });

    // Check outputContains
    if (exec.outputContains && output) {
        for (const expected of exec.outputContains) {
            const found = output.toLowerCase().includes(expected.toLowerCase());
            results.push({
                passed: found,
                component: "execution",
                expected: `output contains "${expected}"`,
                actual: found
                    ? "found"
                    : `not found in: ${output.substring(0, 200)}...`,
                message: !found
                    ? `Expected output to contain "${expected}"`
                    : undefined,
            });
        }
    }

    // Check outputNotContains
    if (exec.outputNotContains && output) {
        for (const notExpected of exec.outputNotContains) {
            const found = output
                .toLowerCase()
                .includes(notExpected.toLowerCase());
            results.push({
                passed: !found,
                component: "execution",
                expected: `output does NOT contain "${notExpected}"`,
                actual: found ? "found (unexpected)" : "not found (correct)",
                message: found
                    ? `Expected output to NOT contain "${notExpected}"`
                    : undefined,
            });
        }
    }

    // Check outputPattern
    if (exec.outputPattern && output) {
        const regex = new RegExp(exec.outputPattern, "i");
        const matches = regex.test(output);
        results.push({
            passed: matches,
            component: "execution",
            expected: `output matches /${exec.outputPattern}/`,
            actual: matches
                ? "matched"
                : `no match in: ${output.substring(0, 200)}...`,
            message: !matches
                ? `Expected output to match pattern: ${exec.outputPattern}`
                : undefined,
        });
    }

    return results;
}

export function evaluateFallback(
    utterance: TestUtterance,
    trace: PipelineTrace,
    _commandResult: unknown,
): EvaluationResult[] {
    const results: EvaluationResult[] = [];
    const fb = utterance.expected.fallback;
    if (!fb) return results;

    results.push({
        passed: fb.shouldFallback === trace.fallbackTriggered,
        component: "fallback",
        expected: fb.shouldFallback ? "fallback triggered" : "no fallback",
        actual: trace.fallbackTriggered ? "fallback triggered" : "no fallback",
        message:
            fb.shouldFallback !== trace.fallbackTriggered
                ? `Expected ${fb.shouldFallback ? "fallback" : "no fallback"} but got ${trace.fallbackTriggered ? "fallback" : "no fallback"}`
                : undefined,
    });

    if (fb.reasoningShouldFix !== undefined) {
        results.push({
            passed: fb.reasoningShouldFix === trace.reasoningInvoked,
            component: "fallback",
            expected: fb.reasoningShouldFix
                ? "reasoning invoked"
                : "no reasoning",
            actual: trace.reasoningInvoked
                ? "reasoning invoked"
                : "no reasoning",
        });
    }

    return results;
}

function extractOutput(commandResult: unknown, trace: PipelineTrace): string {
    if (trace.executionResult?.output) return trace.executionResult.output;
    const result = commandResult as any;
    if (typeof result === "string") return result;
    // CommandResult may have displayText or lastError
    if (result?.displayText) return result.displayText;
    if (result?.result?.displayText) return result.result.displayText;
    if (result?.text) return result.text;
    if (result?.lastError) return result.lastError;
    // Actions array — the output is typically in the display log, not in CommandResult.
    // Return a JSON representation for pattern matching.
    return JSON.stringify(result ?? "");
}

function extractHasError(
    commandResult: unknown,
    trace: PipelineTrace,
): boolean {
    if (trace.executionResult) return !trace.executionResult.success;
    const result = commandResult as any;
    if (result?.error) return true;
    if (result?.lastError) return true;
    if (result?.result?.error) return true;
    return false;
}
