// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { EvaluationResult, TestUtterance } from "../types.mjs";

export function evaluateDisposition(
    utterance: TestUtterance,
    commandResult: unknown,
): EvaluationResult[] {
    const expected = utterance.expected.disposition;
    if (!expected) {
        return [];
    }

    const actual = (
        commandResult as {
            disposition?: {
                status?: string;
                path?: string;
                reason?: string;
                schemas?: string[];
                mayHaveSideEffects?: boolean;
            };
        }
    )?.disposition;
    const actualValues = actual as Record<string, unknown> | undefined;
    const differences: string[] = [];

    for (const [key, expectedValue] of Object.entries(expected)) {
        const actualValue = actualValues?.[key];
        if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
            differences.push(
                `${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
            );
        }
    }

    return [
        {
            passed: differences.length === 0,
            component: "disposition",
            expected,
            actual: actual ?? null,
            message:
                differences.length > 0 ? differences.join("; ") : undefined,
        },
    ];
}
