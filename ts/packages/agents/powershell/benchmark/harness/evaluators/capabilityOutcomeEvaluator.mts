// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { EvaluationResult, TestUtterance } from "../types.mjs";

export function evaluateCapabilityOutcome(
    utterance: TestUtterance,
    commandResult: unknown,
): EvaluationResult[] {
    const expected = utterance.expected.capabilityOutcome;
    if (!expected) {
        return [];
    }

    const actual = (
        commandResult as {
            capabilityOutcome?: Record<string, unknown>;
        }
    )?.capabilityOutcome;
    const differences: string[] = [];
    for (const [key, expectedValue] of Object.entries(expected)) {
        const actualValue = actual?.[key];
        if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
            differences.push(
                `${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
            );
        }
    }

    return [
        {
            passed: differences.length === 0,
            component: "capability-outcome",
            expected,
            actual: actual ?? null,
            message:
                differences.length > 0 ? differences.join("; ") : undefined,
        },
    ];
}
