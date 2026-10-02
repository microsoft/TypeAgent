// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionResultError } from "@typeagent/agent-sdk";
import type { ScriptExecutionResult } from "../execution/powershellRunner.mjs";

export type PowerShellFailureKind =
    | "unknownFlow"
    | "invalidParameters"
    | "scriptFailure"
    | "policyDenied"
    | "integrityFailure"
    | "approvalRequired"
    | "approvalDenied"
    | "stalePlan"
    | "cancelled"
    | "partialSideEffects";

const retryableFailures = new Set<PowerShellFailureKind>([
    "unknownFlow",
    "invalidParameters",
    "scriptFailure",
]);

export function createPowerShellFailure(
    kind: PowerShellFailureKind,
    error: string,
    options?: {
        retryable?: boolean;
        mayHaveSideEffects?: boolean;
    },
): ActionResultError {
    const retryable = options?.retryable ?? retryableFailures.has(kind);
    return {
        error,
        errorCode: `powershell.${kind}`,
        retryable,
        mayHaveSideEffects:
            options?.mayHaveSideEffects ?? kind === "partialSideEffects",
        fallbackToReasoning:
            retryable && kind !== "cancelled" && kind !== "partialSideEffects",
    };
}

export function createPowerShellExecutionFailure(
    result: ScriptExecutionResult,
): ActionResultError {
    switch (result.errorCode) {
        case "powershell.integrityFailure":
        case "powershell.approvalRequired":
        case "powershell.approvalDenied":
        case "powershell.stalePlan":
            return createPowerShellFailure(
                result.errorCode.slice(
                    "powershell.".length,
                ) as PowerShellFailureKind,
                result.stderr,
                { retryable: false },
            );
    }
    if (result.cancelled) {
        return createPowerShellFailure(
            "cancelled",
            "PowerShell execution was cancelled.",
            { retryable: false },
        );
    }
    const error = result.stderr || `Script exited with code ${result.exitCode}`;
    if (
        result.errorCode === "powershell.policyDenied" ||
        result.errorCode?.startsWith("broker.") === true ||
        /broker|denied|not allowed|requires networkAccess|outside allowed|unauthorized/i.test(
            error,
        )
    ) {
        return createPowerShellFailure("policyDenied", error, {
            retryable: false,
        });
    }
    return createPowerShellFailure("scriptFailure", error);
}
