// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface MacroFeatures {
    recording: boolean;
    induction: boolean;
}

function enabled(name: string): boolean {
    const value = process.env[name]?.trim().toLowerCase();
    return value !== "0" && value !== "false" && value !== "off";
}

export function getMacroFeatures(): MacroFeatures {
    return {
        recording: enabled("TYPEAGENT_MACRO_RECORDING_ENABLED"),
        induction: enabled("TYPEAGENT_MACRO_INDUCTION_ENABLED"),
    };
}
