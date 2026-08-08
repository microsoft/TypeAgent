// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProcessCommandOptions } from "@typeagent/dispatcher-types";

export function getReasoningProfileGuidance(
    options?: ProcessCommandOptions,
): string | undefined {
    if (options?.reasoningProfile !== "powershellFlowRecording") {
        return undefined;
    }

    return [
        "[PowerShell flow recording profile]",
        "Handle this request as a reusable PowerShell development action.",
        "Use discover_actions for the powershell schema, then use its typed actions.",
        "If no matching flow exists, create one with createPowerShellFlow and execute it to test it.",
        "Do not create a TaskFlow or WebFlow unless the user explicitly asks for one.",
        "Do not use shell or Bash as a substitute for PowerShell agent actions.",
        "If the task is not suitable for a PowerShell flow, explain that clearly instead of recording a different workflow type.",
    ].join("\n");
}
