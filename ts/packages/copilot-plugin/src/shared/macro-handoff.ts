// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AgentHandoff } from "@typeagent/agent-sdk";
import { getMacroFeatures } from "./macro-features.js";

export const macroHandoffGuidance =
    "Caller only: if TypeAgent returns agentRequired with a launch payload, invoke the typeagent-macro-runner agent with the complete launch object. The server has already validated the macro; neither the caller nor runner should call inspect_macro before execution. If you are already the typeagent-macro-runner, execute the supplied launch yourself; never delegate it to another agent. Do not call run_macro again, reconstruct the procedure, or repeat the original request. The runner executes the whole approved macro under live permissions; a denial, cancellation, or failure is terminal.";

export function validateMacroHandoff(handoff: AgentHandoff): void {
    if (
        handoff.agentName !== "typeagent-macro-runner" ||
        !handoff.payload ||
        typeof handoff.payload !== "object"
    ) {
        throw new Error("TypeAgent returned an unsupported agent handoff.");
    }
    if (!getMacroFeatures().agentHandoff) {
        throw new Error(
            "Macro agent-runner handoff is disabled by configuration. Do not repeat the request.",
        );
    }
}

export function macroHandoffContext(handoff: AgentHandoff): string {
    validateMacroHandoff(handoff);
    return `${macroHandoffGuidance}\n\n${JSON.stringify(
        { status: "agentRequired", launch: handoff.payload },
        null,
        2,
    )}`;
}
