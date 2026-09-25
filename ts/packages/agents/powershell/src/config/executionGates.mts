// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadConfigSync } from "@typeagent/config";

const DYNAMIC_EXECUTION_KEY = "POWERSHELL_DYNAMICEXECUTION_ENABLED";

export interface PowerShellExecutionGates {
    dynamicExecution: {
        enabled: boolean;
    };
}

export function getPowerShellExecutionGates(): PowerShellExecutionGates {
    try {
        const { env } = loadConfigSync({
            populateProcessEnv: false,
            strict: false,
        });
        return {
            dynamicExecution: {
                enabled: env[DYNAMIC_EXECUTION_KEY] === "1",
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
