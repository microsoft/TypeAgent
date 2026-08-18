// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface MacroFeatures {
    recording: boolean;
    induction: boolean;
    replay: boolean;
    agentHandoff: boolean;
}

function enabled(name: string): boolean {
    const value = process.env[name]?.trim().toLowerCase();
    return value !== "0" && value !== "false" && value !== "off";
}

export function getMacroFeatures(): MacroFeatures {
    return {
        recording: enabled("TYPEAGENT_MACRO_RECORDING_ENABLED"),
        induction: enabled("TYPEAGENT_MACRO_INDUCTION_ENABLED"),
        replay: enabled("TYPEAGENT_MACRO_REPLAY_ENABLED"),
        agentHandoff: enabled("TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED"),
    };
}
