// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TypeAgentAction } from "@typeagent/agent-sdk";
import type {
    CommandDisposition,
    PowerShellCapabilityOutcome,
} from "@typeagent/dispatcher-types";

const outcomeActionName = "reportPowerShellCapabilityOutcome";

export function getPowerShellCapabilityOutcome(
    actions: readonly TypeAgentAction[] | undefined,
): PowerShellCapabilityOutcome | undefined {
    const action = actions
        ? [...actions]
              .reverse()
              .find(
                  (candidate: TypeAgentAction) =>
                      candidate.schemaName === "powershell" &&
                      candidate.actionName === outcomeActionName,
              )
        : undefined;
    const parameters = action?.parameters as
        | Record<string, unknown>
        | undefined;
    if (!parameters) {
        return undefined;
    }
    const status = parameters?.status;
    switch (status) {
        case "handledExisting": {
            const schema = parameters.schema;
            const actionName = parameters.actionName;
            if (typeof schema !== "string" || typeof actionName !== "string") {
                return undefined;
            }
            return {
                status,
                schema,
                actionName,
                ...(typeof parameters.flowName === "string"
                    ? { flowName: parameters.flowName }
                    : {}),
            };
        }
        case "created":
            return typeof parameters.flowName === "string"
                ? { status, flowName: parameters.flowName }
                : undefined;
        case "notSuitable":
            return typeof parameters.reasonCode === "string"
                ? { status, reasonCode: parameters.reasonCode }
                : undefined;
        case "failed": {
            const phase = parameters.phase;
            const reason = parameters.reason;
            if (
                !isFailurePhase(phase) ||
                typeof parameters.mayHaveSideEffects !== "boolean" ||
                typeof reason !== "string"
            ) {
                return undefined;
            }
            return {
                status,
                phase,
                mayHaveSideEffects: parameters.mayHaveSideEffects,
                reason,
            };
        }
        default:
            return undefined;
    }
}

export function getPowerShellCapabilityDisposition(
    outcome: PowerShellCapabilityOutcome,
): CommandDisposition {
    if (outcome.status === "notSuitable") {
        return {
            status: "notHandled",
            reason: "notPowerShellCapable",
        };
    }
    if (outcome.status === "failed") {
        return {
            status: "failed",
            path: "reasoning",
            mayHaveSideEffects: outcome.mayHaveSideEffects,
        };
    }
    return {
        status: "handled",
        path: "reasoning",
        schemas:
            outcome.status === "handledExisting"
                ? [outcome.schema]
                : ["powershell"],
    };
}

function isFailurePhase(
    value: unknown,
): value is Extract<
    PowerShellCapabilityOutcome,
    { status: "failed" }
>["phase"] {
    return (
        value === "classify" ||
        value === "discover" ||
        value === "validate" ||
        value === "execute" ||
        value === "persist"
    );
}
