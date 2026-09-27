// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConfigSource,
    getConfigProblems,
    loadConfigSync,
} from "@typeagent/config";

const DYNAMIC_EXECUTION_KEY = "POWERSHELL_DYNAMICEXECUTION_ENABLED";
const ALLOWED_CONFIG_SOURCES = new Set<ConfigSource>([
    ConfigSource.Defaults,
    ConfigSource.Local,
]);

export interface PowerShellExecutionGates {
    dynamicExecution: {
        enabled: boolean;
    };
}

export function getPowerShellExecutionGates(): PowerShellExecutionGates {
    try {
        const { env, sources } = loadConfigSync({
            populateProcessEnv: false,
            strict: true,
            trackSources: true,
        });
        const source = sources?.[DYNAMIC_EXECUTION_KEY];
        return {
            dynamicExecution: {
                enabled:
                    getConfigProblems().length === 0 &&
                    env[DYNAMIC_EXECUTION_KEY] === "1" &&
                    source !== undefined &&
                    ALLOWED_CONFIG_SOURCES.has(source),
            },
        };
    } catch {
        return {
            dynamicExecution: {
                enabled: false,
            },
        };
    }
}

export function isDynamicPowerShellExecutionEnabled(): boolean {
    return getPowerShellExecutionGates().dynamicExecution.enabled;
}
