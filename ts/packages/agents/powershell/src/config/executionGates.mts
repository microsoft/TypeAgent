// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConfigSource,
    getConfigProblems,
    loadConfigSync,
} from "@typeagent/config";

const DYNAMIC_EXECUTION_KEY = "POWERSHELL_DYNAMICEXECUTION_ENABLED";
const BROKER_EXECUTION_KEY = "POWERSHELL_BROKEREXECUTION_ENABLED";
const ALLOWED_CONFIG_SOURCES = new Set<ConfigSource>([
    ConfigSource.Defaults,
    ConfigSource.Local,
]);

export interface PowerShellExecutionGates {
    brokerExecution: {
        enabled: boolean;
    };
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
        const dynamicSource = sources?.[DYNAMIC_EXECUTION_KEY];
        const brokerSource = sources?.[BROKER_EXECUTION_KEY];
        const hasProblems = getConfigProblems().length > 0;
        return {
            brokerExecution: {
                enabled:
                    !hasProblems &&
                    env[BROKER_EXECUTION_KEY] === "1" &&
                    brokerSource !== undefined &&
                    ALLOWED_CONFIG_SOURCES.has(brokerSource),
            },
            dynamicExecution: {
                enabled:
                    !hasProblems &&
                    env[DYNAMIC_EXECUTION_KEY] === "1" &&
                    dynamicSource !== undefined &&
                    ALLOWED_CONFIG_SOURCES.has(dynamicSource),
            },
        };
    } catch {
        return {
            brokerExecution: {
                enabled: false,
            },
            dynamicExecution: {
                enabled: false,
            },
        };
    }
}

export function isDynamicPowerShellExecutionEnabled(): boolean {
    return getPowerShellExecutionGates().dynamicExecution.enabled;
}

export function isBrokeredPowerShellExecutionEnabled(): boolean {
    return getPowerShellExecutionGates().brokerExecution.enabled;
}
