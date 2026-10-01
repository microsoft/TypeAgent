// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AgentHandoff } from "@typeagent/agent-sdk";
import { getMacroFeatures } from "./macro-features.js";

export const macroHandoffGuidance =
    "If TypeAgent returns agentRequired with a launch payload, invoke the typeagent-macro-runner agent with the complete launch object. Do not call run_macro again, reconstruct the procedure, or repeat the original request. The runner executes the whole approved macro under live permissions; a denial, cancellation, or failure is terminal.";

export function macroHandoffContext(handoff: AgentHandoff): string {
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
    return `${macroHandoffGuidance}\n\n${JSON.stringify(
        { status: "agentRequired", launch: handoff.payload },
        null,
        2,
    )}`;
}
