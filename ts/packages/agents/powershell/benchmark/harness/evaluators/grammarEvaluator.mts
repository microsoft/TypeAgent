// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    EvaluationResult,
    PipelineTrace,
    TestUtterance,
} from "../types.mjs";

export function evaluateGrammarMatch(
    utterance: TestUtterance,
    trace: PipelineTrace,
    commandResult: unknown,
): EvaluationResult[] {
    const results: EvaluationResult[] = [];
    const expected = utterance.expected;

    // Check if the right flow was matched
    if (expected.matchedFlow !== undefined) {
        const actualFlow = extractFlowName(commandResult, trace);
        if (expected.matchedFlow === null) {
            // Negative test: should NOT match any powershell
            results.push({
                passed:
                    actualFlow === null || trace.matchedAgent !== "powershell",
                component: "grammar",
                expected: "no powershell match",
                actual: actualFlow ?? "no match",
                message:
                    actualFlow && trace.matchedAgent === "powershell"
                        ? `Expected no powershell match but matched '${actualFlow}'`
                        : undefined,
            });
        } else {
            results.push({
                passed:
                    actualFlow?.toLowerCase() ===
                    expected.matchedFlow.toLowerCase(),
                component: "grammar",
                expected: expected.matchedFlow,
                actual: actualFlow ?? "no match",
                message:
                    actualFlow !== expected.matchedFlow
                        ? `Expected flow '${expected.matchedFlow}' but got '${actualFlow ?? "no match"}'`
                        : undefined,
            });
        }
    }

    // Check extracted parameters
    if (
        expected.extractedParams &&
        Object.keys(expected.extractedParams).length > 0
    ) {
        const actualParams = extractParams(commandResult, trace);
        for (const [key, expectedValue] of Object.entries(
            expected.extractedParams,
        )) {
            // Per-flow types: params are named directly on the action
            let actualValue = findParamCaseInsensitive(actualParams, key);
            // Legacy fallback: flowArgs (single wildcard capture)
            if (actualValue === undefined) {
                actualValue = findParamCaseInsensitive(
                    actualParams,
                    "flowArgs",
                );
            }
            // Legacy fallback: flowParametersJson (LLM translation)
            if (actualValue === undefined) {
                const fpJson = findParamCaseInsensitive(
                    actualParams,
                    "flowParametersJson",
                );
                if (typeof fpJson === "string") {
                    try {
                        const parsed = JSON.parse(fpJson);
                        actualValue = findParamCaseInsensitive(parsed, key);
                    } catch {
                        /* ignore */
                    }
                }
            }
            const matches = normalizedEqual(actualValue, expectedValue);
            results.push({
                passed: matches,
                component: "parameters",
                expected: { [key]: expectedValue },
                actual: { [key]: actualValue },
                message: !matches
                    ? `Parameter '${key}': expected '${expectedValue}' but got '${actualValue}'`
                    : undefined,
            });
        }
    }

    return results;
}

function extractFlowName(
    commandResult: unknown,
    trace: PipelineTrace,
): string | null {
    if (trace.matchedAction) return trace.matchedAction;
    const result = commandResult as any;

    // CommandResult.actions[] from the dispatcher (collectCommandResult: true)
    // Each action is { schemaName, actionName, parameters }
    const firstAction = result?.actions?.[0];
    if (firstAction) {
        // Per-flow action types: actionName IS the flow name
        if (firstAction.schemaName === "powershell") {
            return firstAction.actionName;
        }
        // Legacy: executePowerShellFlow with flowName param
        if (firstAction.parameters?.flowName) {
            return firstAction.parameters.flowName;
        }
        return firstAction.actionName ?? null;
    }

    if (result?.action?.actionName) return result.action.actionName;
    if (result?.action?.parameters?.flowName)
        return result.action.parameters.flowName;
    return null;
}

function extractParams(
    commandResult: unknown,
    trace: PipelineTrace,
): Record<string, unknown> {
    if (trace.extractedParams) return trace.extractedParams;
    const result = commandResult as any;

    // CommandResult.actions[] — extract parameters from the first action
    const firstAction = result?.actions?.[0];
    if (firstAction?.parameters) return firstAction.parameters;
    if (result?.action?.parameters) return result.action.parameters;
    return {};
}

function findParamCaseInsensitive(
    params: Record<string, unknown>,
    key: string,
): unknown {
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(params)) {
        if (k.toLowerCase() === lowerKey) return v;
    }
    return undefined;
}

function normalizedEqual(actual: unknown, expected: unknown): boolean {
    if (actual === expected) return true;
    if (actual === undefined || actual === null) return false;

    // String comparison: case-insensitive, normalize path separators
    if (typeof actual === "string" && typeof expected === "string") {
        const normActual = actual.replace(/\\/g, "/").toLowerCase().trim();
        const normExpected = expected.replace(/\\/g, "/").toLowerCase().trim();
        return normActual === normExpected;
    }

    // Number comparison
    if (typeof actual === "number" && typeof expected === "number") {
        return actual === expected;
    }

    // Coerce string to number
    if (typeof actual === "string" && typeof expected === "number") {
        return parseFloat(actual) === expected;
    }

    return String(actual).toLowerCase() === String(expected).toLowerCase();
}
