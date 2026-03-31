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
    const parts: string[] = [];

    // Display text captured from the display history pipeline
    if (trace.executionResult?.output) {
        parts.push(trace.executionResult.output);
    }

    // Also check the command result object itself for text content
    const result = commandResult as any;
    if (typeof result === "string") {
        parts.push(result);
    } else if (result) {
        if (result.displayText) parts.push(result.displayText);
        if (result.result?.displayText) parts.push(result.result.displayText);
        if (result.text) parts.push(result.text);
        if (result.lastError) parts.push(result.lastError);
        // Check for action results embedded in the command result
        if (result.actions) {
            for (const action of result.actions) {
                if (action.result?.displayContent) {
                    const dc = action.result.displayContent;
                    if (typeof dc === "string") parts.push(dc);
                    else if (Array.isArray(dc)) parts.push(dc.join("\n"));
                }
                if (action.result?.historyText) {
                    parts.push(action.result.historyText);
                }
            }
        }
    }

    return parts.filter(Boolean).join("\n") || JSON.stringify(result ?? "");
}

function extractHasError(
    commandResult: unknown,
    trace: PipelineTrace,
): boolean {
    // Check the display output for clear success/error indicators first.
    // This is more reliable than commandResult.lastError which can be set
    // by unrelated agents (e.g. browser agent init error).
    const output = extractOutput(commandResult, trace);
    if (output) {
        const hasSuccessIndicator =
            /deleted|completed|success|task flow|digest|playlist/i.test(output);
        const hasErrorIndicator =
            /^error:|failed:|not found|unknown task flow/i.test(output);
        if (hasSuccessIndicator && !hasErrorIndicator) return false;
        if (hasErrorIndicator && !hasSuccessIndicator) return true;
    }

    // Fall back to trace and result inspection
    if (trace.executionResult) return !trace.executionResult.success;
    const result = commandResult as any;
    if (result?.error) return true;
    if (result?.result?.error) return true;
    return false;
}
