// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProcessCommandOptions } from "@typeagent/dispatcher-types";

export function getReasoningProfileGuidance(
    options?: ProcessCommandOptions,
): string | undefined {
    switch (options?.reasoningProfile) {
        case "powershellFlowRecording":
            return getPowerShellFlowRecordingGuidance();
        case "powershellCapabilityFallback":
            return getPowerShellCapabilityFallbackGuidance();
        default:
            return undefined;
    }
}

function getPowerShellFlowRecordingGuidance(): string {
    return [
        "[PowerShell flow recording profile]",
        "Handle this request as a reusable PowerShell development action.",
        "Use discover_actions for the powershell schema, then use its typed actions.",
        "If no matching flow exists, use createAndExecutePowerShellFlow so the script executes once and is promoted only after success.",
        "Classify filesystem script parameters as type path and parameters passed as executable commands, such as Start-Process -FilePath, as type executable.",
        "Do not create a TaskFlow or WebFlow unless the user explicitly asks for one.",
        "Do not use shell or Bash as a substitute for PowerShell agent actions.",
        "If the task is not suitable for a PowerShell flow, explain that clearly instead of recording a different workflow type.",
    ].join("\n");
}

function getPowerShellCapabilityFallbackGuidance(): string {
    return [
        "[PowerShell capability fallback profile]",
        "Decide whether the user's request can be safely completed as a reusable PowerShell flow.",
        "Use discover_actions for the powershell schema and listPowerShellFlows before creating anything.",
        "Prefer an existing executable action or flow. If an existing flow covers the task but misses this phrasing, add validated patterns with addPowerShellFlowPatterns, then execute the existing flow once.",
        "If an existing flow fails with errorCode powershell.scriptFailure, repair that same flow with repairAndExecutePowerShellFlow at most once. Do not repair policyDenied, cancelled, or partialSideEffects failures.",
        "If no equivalent exists, use createAndExecutePowerShellFlow. It executes the draft once and promotes it only after success. Do not execute the promoted flow again.",
        "Classify filesystem script parameters as type path and parameters passed as executable commands, such as Start-Process -FilePath, as type executable.",
        "Do not use shell, Bash, TaskFlow, or WebFlow as substitutes.",
        "You MUST finish by calling reportPowerShellCapabilityOutcome exactly once.",
        "Report handledExisting after an existing action or flow succeeds.",
        "Report created after createAndExecutePowerShellFlow succeeds.",
        "Report notSuitable when the request is not a PowerShell task or classification is uncertain.",
        "Report failed with the precise phase and whether execution may have caused side effects.",
    ].join("\n");
}
